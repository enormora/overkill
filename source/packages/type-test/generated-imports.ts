import { isBuiltin } from 'node:module';
import { dirname, relative, resolve } from 'node:path';
import type * as CompilerApi from 'typescript-beta/async';
import type * as TypeScript from 'typescript-beta/ast';
import type { FrozenProject } from './frozen-project.ts';
import type { CompilerSyntax } from './installed-compiler.ts';
import { mapSourceRange, replaceMappedText, type TranslatedModule, type SourceRange } from './generated-source.ts';

export type ImportDiagnostic = {
    readonly path: string;
    readonly ranges: ReturnType<typeof mapSourceRange>;
    readonly message: string;
};
export type RepairedModule = {
    readonly module: TranslatedModule;
    readonly dependencies: readonly string[];
    readonly repairs: readonly {
        readonly from: string;
        readonly to: string;
    }[];
    readonly diagnostics: readonly ImportDiagnostic[];
};
type ImportRepair = {
    readonly kind: 'ambiguous';
    readonly diagnostic: ImportDiagnostic;
} | {
    readonly kind: 'repair';
    readonly path: string;
    readonly from: string;
    readonly to: string;
    readonly range: SourceRange;
} | {
    readonly kind: 'unrelated';
};
type ResolutionContext = {
    readonly compiler: CompilerSyntax;
    readonly project: FrozenProject;
    readonly options: CompilerApi.CompilerOptions;
    readonly module: TranslatedModule;
    readonly source: TypeScript.SourceFile;
    readonly paths: ReadonlyMap<string, string>;
};
function moduleReference(compiler: CompilerSyntax, node: TypeScript.Node): TypeScript.Node | undefined {
    if (compiler.isImportDeclaration(node) || compiler.isExportDeclaration(node)) {
        return node.moduleSpecifier;
    }
    if (compiler.isExternalModuleReference(node)) {
        return node.expression;
    }
    if (compiler.isImportTypeNode(node) && compiler.isLiteralTypeNode(node.argument)) {
        return node.argument.literal;
    }
    return undefined;
}

function dynamicReference(compiler: CompilerSyntax, node: TypeScript.Node): TypeScript.Node | undefined {
    return compiler.isCallExpression(node) && node.expression.kind === compiler.SyntaxKind.ImportKeyword
        ? node.arguments[0]
        : undefined;
}

function moduleReferences(
    compiler: CompilerSyntax,
    source: TypeScript.SourceFile
): readonly TypeScript.StringLiteralLikeNode[] {
    const literals: TypeScript.StringLiteralLikeNode[] = [];
    function visit(node: TypeScript.Node): void {
        const reference = moduleReference(compiler, node) ?? dynamicReference(compiler, node);
        if (reference !== undefined && compiler.isStringLiteralLike(reference)) {
            literals.push(reference);
        }
        node.forEachChild(visit);
    }
    visit(source);
    return literals.toSorted(function descending(left, right) {
        return right.pos - left.pos;
    });
}

function siblingSpecifier(path: string, target: string, original: string): string {
    const sibling = relative(dirname(path), target).replaceAll('\\', '/');
    const specifier = sibling.startsWith('../') ? sibling : `./${sibling}`;
    return /\.(?:tsx?|mts|cts)$/u.test(original)
        ? specifier
        : specifier.replace(/\.mts$/u, '.mjs').replace(/\.cts$/u, '.cjs').replace(/\.tsx?$/u, '.js');
}

function ambiguous(context: ResolutionContext, literal: TypeScript.StringLiteralLikeNode): ImportRepair {
    return {
        kind: 'ambiguous',
        diagnostic: {
            path: context.module.path,
            ranges: mapSourceRange(
                context
                    .module
                    .mappings,
                { start: literal.getStart(context.source), end: literal.end },
                'generated'
            ),
            message: `Cannot resolve import safely: ${literal.text}`
        }
    };
}

function verifiedRepair(
    context: ResolutionContext,
    literal: TypeScript.StringLiteralLikeNode,
    path: string,
    generated: string
): ImportRepair {
    const to = siblingSpecifier(context.module.path, generated, literal.text);
    return {
        kind: 'repair',
        path,
        from: literal.text,
        to,
        range: { start: literal.getStart(context.source), end: literal.end }
    };
}

async function originalImport(
    context: ResolutionContext,
    literal: TypeScript.StringLiteralLikeNode
): Promise<TypeScript.StringLiteralLikeNode | undefined> {
    const { compiler, module, project } = context;
    const original = await project.program.getSourceFile(module.path);
    const ranges = mapSourceRange(
        module.mappings,
        { start: literal.getStart(context.source), end: literal.end },
        'generated'
    );
    return original === undefined
        ? undefined
        : moduleReferences(compiler, original).find(function matching(candidate) {
            return candidate.text === literal.text && ranges.some(function contains(range) {
                return candidate.getStart(original) <= range.start && candidate.end >= range.end;
            });
        });
}

async function resolveRepair(
    context: ResolutionContext,
    literal: TypeScript.StringLiteralLikeNode
): Promise<ImportRepair> {
    const { paths, project } = context;
    if (literal.text === 'tstyche') {
        return { kind: 'unrelated' };
    }
    const originalLiteral = await originalImport(context, literal);
    const target = originalLiteral === undefined
        ? undefined
        : await project.program.getResolvedModuleFromModuleSpecifier(originalLiteral);
    if (target === undefined) {
        return isBuiltin(literal.text) ? { kind: 'unrelated' } : ambiguous(context, literal);
    }
    const originalPath = resolve(target.resolvedFileName);
    const generatedPath = paths.get(originalPath);
    return generatedPath === undefined
        ? { kind: 'unrelated' }
        : verifiedRepair(context, literal, originalPath, generatedPath);
}

function applyRepair(result: RepairedModule, repair: ImportRepair): RepairedModule {
    if (repair.kind === 'unrelated') {
        return result;
    }
    if (repair.kind === 'ambiguous') {
        return { ...result, diagnostics: [ ...result.diagnostics, repair.diagnostic ] };
    }
    return {
        ...result,
        module: replaceMappedText(result.module, repair.range, JSON.stringify(repair.to)),
        dependencies: [ ...result.dependencies, repair.path ],
        repairs: [ ...result.repairs, { from: repair.from, to: repair.to } ]
    };
}

export async function repairGeneratedImports(
    project: FrozenProject,
    options: CompilerApi.CompilerOptions,
    module: TranslatedModule,
    paths: ReadonlyMap<string, string>
): Promise<RepairedModule> {
    const compiler = project.compiler.syntax;
    await using lease = await project.api.createSourceFile(module.path, module.text);
    const source = lease.sourceFile;
    const context = { compiler, project, options, module, paths, source };
    let result: RepairedModule = { module, dependencies: [], repairs: [], diagnostics: [] };
    for (const literal of moduleReferences(compiler, source)) {
        result = applyRepair(result, await resolveRepair(context, literal));
    }
    return result;
}
