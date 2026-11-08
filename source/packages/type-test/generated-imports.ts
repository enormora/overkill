import { isBuiltin } from 'node:module';
import { dirname, relative, resolve } from 'node:path';
import type TypeScript from 'typescript';
import { mapSourceRange, replaceMappedText, type TranslatedModule, type SourceRange } from './generated-source.ts';

export type ImportDiagnostic = {
    readonly path: string;
    readonly ranges: ReturnType<typeof mapSourceRange>;
    readonly message: string;
};
export type RepairedModule = {
    readonly module: TranslatedModule;
    readonly dependencies: readonly string[];
    readonly repairs: readonly { readonly from: string; readonly to: string; }[];
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
} | { readonly kind: 'unrelated'; };
type ResolutionContext = {
    readonly compiler: typeof TypeScript;
    readonly options: TypeScript.CompilerOptions;
    readonly module: TranslatedModule;
    readonly source: TypeScript.SourceFile;
    readonly paths: ReadonlyMap<string, string>;
};

function moduleReference(compiler: typeof TypeScript, node: TypeScript.Node): TypeScript.Node | undefined {
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
function dynamicReference(compiler: typeof TypeScript, node: TypeScript.Node): TypeScript.Node | undefined {
    return compiler.isCallExpression(node) && node.expression.kind === compiler.SyntaxKind.ImportKeyword
        ? node.arguments[0]
        : undefined;
}
function moduleReferences(
    compiler: typeof TypeScript,
    source: TypeScript.SourceFile
): readonly TypeScript.StringLiteralLike[] {
    const literals: TypeScript.StringLiteralLike[] = [];
    function visit(node: TypeScript.Node): void {
        const reference = moduleReference(compiler, node) ?? dynamicReference(compiler, node);
        if (reference !== undefined && compiler.isStringLiteralLike(reference)) {
            literals.push(reference);
        }
        compiler.forEachChild(node, visit);
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
function ambiguous(context: ResolutionContext, literal: TypeScript.StringLiteralLike): ImportRepair {
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
    literal: TypeScript.StringLiteralLike,
    path: string,
    generated: string
): ImportRepair {
    const to = siblingSpecifier(context.module.path, generated, literal.text);
    const host = {
        ...context.compiler.sys,
        fileExists(candidate: string): boolean {
            return Array.from(context.paths.values()).includes(resolve(candidate)) ||
                context.compiler.sys.fileExists(candidate);
        }
    };
    const mode = context.compiler.getModeForUsageLocation(context.source, literal, context.options);
    const target = context
        .compiler
        .resolveModuleName(to, context.module.path, context.options, host, undefined, undefined, mode)
        .resolvedModule;
    if (target === undefined || resolve(target.resolvedFileName) !== generated) {
        return ambiguous(context, literal);
    }
    return {
        kind: 'repair',
        path,
        from: literal.text,
        to,
        range: { start: literal.getStart(context.source), end: literal.end }
    };
}
function resolveRepair(context: ResolutionContext, literal: TypeScript.StringLiteralLike): ImportRepair {
    const { compiler, options, module, paths, source } = context;
    const mode = compiler.getModeForUsageLocation(source, literal, options);
    const target = compiler
        .resolveModuleName(literal.text, module.path, options, compiler.sys, undefined, undefined, mode)
        .resolvedModule;
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
export function repairGeneratedImports(
    compiler: typeof TypeScript,
    options: TypeScript.CompilerOptions,
    module: TranslatedModule,
    paths: ReadonlyMap<string, string>
): RepairedModule {
    const source = compiler.createSourceFile(module.path, module.text, {
        languageVersion: compiler.ScriptTarget.Latest,
        impliedNodeFormat: compiler.getImpliedNodeFormatForFile(module.path, undefined, compiler.sys, options)
    }, true);
    const context = { compiler, options, module, paths, source };
    return moduleReferences(compiler, source).reduce<RepairedModule>(function repair(result, literal) {
        return applyRepair(result, resolveRepair(context, literal));
    }, { module, dependencies: [], repairs: [], diagnostics: [] });
}
