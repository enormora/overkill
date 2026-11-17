import type * as CompilerApi from 'typescript-beta/async';
import type * as TypeScript from 'typescript-beta/ast';
import { UnsupportedEvidenceError } from './unsupported-evidence-error.ts';
import {
    immutableInitializer,
    sourceChildren,
    sourceIdentifiers,
    loadSourceSymbols,
    sourceDeclarations,
    sourceSymbol,
    transparentExpression,
    type SourceAnalysis
} from './source-analysis.ts';

export async function supportedCall(analysis: SourceAnalysis, call: TypeScript.CallExpression): Promise<boolean> {
    const signature = await analysis.checker.getResolvedSignature(call);
    const declaration = await signature.declaration?.resolve();
    const path = declaration?.getSourceFile().fileName.replaceAll('\\', '/') ?? '';
    return /\/(?:source\/(?:engine|authoring|packages\/(?:engine|test))|node_modules\/@overkill-dev\/(?:engine|test))\//u
        .test(path);
}
function storageUse(analysis: SourceAnalysis, node: TypeScript.Expression): TypeScript.Expression {
    const { parent } = node;
    return analysis.compiler.isExpression(parent) && transparentExpression(analysis, parent) === node
        ? storageUse(analysis, parent)
        : node;
}
function declarationUse(analysis: SourceAnalysis, node: TypeScript.Expression): boolean {
    return analysis.compiler.isIdentifier(node) && analysis.compiler.isVariableDeclaration(node.parent) &&
        node.parent.name === node;
}
function staticReference(analysis: SourceAnalysis, node: TypeScript.Expression): boolean {
    const { compiler } = analysis;
    return compiler.isImportSpecifier(node.parent) || compiler.isTypeQueryNode(node.parent) ||
        compiler.isQualifiedName(node.parent);
}
async function allowedUse(analysis: SourceAnalysis, node: TypeScript.Expression): Promise<boolean> {
    const use = storageUse(analysis, node);
    const { parent } = use;
    const { compiler } = analysis;
    if (declarationUse(analysis, use) || staticReference(analysis, use)) {
        return true;
    }
    return compiler.isCallExpression(parent) && parent.arguments.some(function matching(argument) {
        return argument === use;
    }) && await supportedCall(analysis, parent);
}
function storageAlias(analysis: SourceAnalysis, node: TypeScript.Expression): TypeScript.BindingName | undefined {
    const use = storageUse(analysis, node);
    const { parent } = use;
    if (
        analysis.compiler.isVariableDeclaration(parent) && analysis.compiler.isIdentifier(parent.name) &&
        parent.initializer === use &&
        immutableInitializer(analysis, parent) !== undefined
    ) {
        return parent.name;
    }
    return undefined;
}
function addBindingNames(
    compiler: SourceAnalysis['compiler'],
    bindings: TypeScript.NamedImportBindings,
    addName: (name: string) => void
): void {
    if (compiler.isNamespaceImport(bindings)) {
        addName(bindings.name.text);
    } else {
        for (const binding of bindings.elements) {
            addName(binding.name.text);
        }
    }
}
function addImportNames(
    compiler: SourceAnalysis['compiler'],
    clause: TypeScript.ImportClause,
    addName: (name: string) => void
): void {
    if (clause.name !== undefined) {
        addName(clause.name.text);
    }
    if (clause.namedBindings !== undefined) {
        addBindingNames(compiler, clause.namedBindings, addName);
    }
}
function referenceNames(
    analysis: SourceAnalysis,
    file: TypeScript.SourceFile,
    symbol: CompilerApi.Symbol
): ReadonlySet<string> {
    const names = new Set([ symbol.name ]);
    for (const statement of file.statements) {
        if (analysis.compiler.isImportEqualsDeclaration(statement)) {
            names.add(statement.name.text);
        }
        if (analysis.compiler.isImportDeclaration(statement) && statement.importClause !== undefined) {
            addImportNames(analysis.compiler, statement.importClause, function addReferenceName(name) {
                names.add(name);
            });
        }
    }
    return names;
}
async function validateStorageReference(
    analysis: SourceAnalysis,
    node: TypeScript.Expression,
    validate: (node: TypeScript.Node) => Promise<void>
): Promise<void> {
    const alias = storageAlias(analysis, node);
    if (alias !== undefined) {
        await validate(alias);
    } else if (!await allowedUse(analysis, node)) {
        throw new UnsupportedEvidenceError(
            'Callback options may be mutated or escape static source ownership.',
            undefined
        );
    }
}
async function validateFileReferences(
    analysis: SourceAnalysis,
    file: TypeScript.SourceFile,
    symbol: CompilerApi.Symbol,
    validate: (node: TypeScript.Node) => Promise<void>
): Promise<void> {
    const names = referenceNames(analysis, file, symbol);
    const identifiers = sourceIdentifiers(analysis, file).filter(function matchingName(node) {
        return names.has(node.text);
    });
    await loadSourceSymbols(analysis, identifiers);
    async function visit(node: TypeScript.Node): Promise<void> {
        if (
            analysis.compiler.isIdentifier(node) && names.has(node.text) &&
            await sourceSymbol(analysis, node) === symbol
        ) {
            await validateStorageReference(analysis, node, validate);
        }
        for (const child of sourceChildren(node)) {
            await visit(child);
        }
    }
    await visit(file);
}
async function validateReferences(
    analysis: SourceAnalysis,
    symbol: CompilerApi.Symbol,
    validate: (node: TypeScript.Node) => Promise<void>
): Promise<void> {
    const names = await analysis.program.getSourceFileNames();
    const paths = names.filter(function applicationSource(path) {
        return !/[/\\]node_modules[/\\]/u.test(path) && !/\.d\.[cm]?ts$/u.test(path);
    });
    for (const path of paths) {
        const file = await analysis.program.getSourceFile(path);
        if (file !== undefined && !file.isDeclarationFile && !file.fileName.includes('/node_modules/')) {
            await validateFileReferences(analysis, file, symbol, validate);
        }
    }
}
function exportedStorage(analysis: SourceAnalysis, declaration: TypeScript.Declaration): boolean {
    const { compiler } = analysis;
    if (!compiler.isVariableDeclaration(declaration) || !compiler.isVariableDeclarationList(declaration.parent)) {
        return false;
    }
    const statement = declaration.parent.parent;
    if (!compiler.isVariableStatement(statement)) {
        return false;
    }
    const modifiers = statement.modifiers ?? [];
    return modifiers.some(function exported(modifier) {
        return modifier.kind === compiler.SyntaxKind.ExportKeyword;
    });
}
async function validateInitializers(
    analysis: SourceAnalysis,
    symbol: CompilerApi.Symbol,
    validate: (node: TypeScript.Node) => Promise<void>
): Promise<void> {
    const declarations = await sourceDeclarations(symbol);
    for (const declaration of declarations) {
        if (exportedStorage(analysis, declaration)) {
            throw new UnsupportedEvidenceError('Exported callback options escape static source ownership.', undefined);
        }
        const initializer = immutableInitializer(analysis, declaration);
        if (initializer !== undefined) {
            await validate(initializer);
        }
    }
}
export async function validateCallbackStorage(analysis: SourceAnalysis, initial: TypeScript.Node): Promise<void> {
    const seen = new Set<CompilerApi.Symbol>();
    async function validate(input: TypeScript.Node): Promise<void> {
        const inner = transparentExpression(analysis, input);
        if (inner !== undefined) {
            await validate(inner);
            return;
        }
        const symbol = analysis.compiler.isIdentifier(input) ? await sourceSymbol(analysis, input) : undefined;
        if (symbol === undefined || seen.has(symbol)) {
            return;
        }
        seen.add(symbol);
        await validateInitializers(analysis, symbol, validate);
        await validateReferences(analysis, symbol, validate);
    }
    await validate(initial);
}
