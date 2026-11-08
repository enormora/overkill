import type TypeScript from 'typescript';
import { immutableInitializer, sourceSymbol, transparentExpression, type SourceAnalysis } from './source-analysis.ts';

export function supportedCall(analysis: SourceAnalysis, call: TypeScript.CallExpression): boolean {
    const declaration = analysis.checker.getResolvedSignature(call)?.declaration;
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

function allowedUse(analysis: SourceAnalysis, node: TypeScript.Expression): boolean {
    const use = storageUse(analysis, node);
    const { parent } = use;
    const { compiler } = analysis;
    if (declarationUse(analysis, use) || staticReference(analysis, use)) {
        return true;
    }
    return compiler.isCallExpression(parent) && parent.arguments.some(function matching(argument) {
        return argument === use;
    }) && supportedCall(analysis, parent);
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

function validateReferences(
    analysis: SourceAnalysis,
    symbol: TypeScript.Symbol,
    validate: (node: TypeScript.Node) => void
): void {
    const { compiler } = analysis;
    function visit(node: TypeScript.Node): void {
        if (compiler.isIdentifier(node) && sourceSymbol(analysis, node) === symbol) {
            const alias = storageAlias(analysis, node);
            if (alias !== undefined) {
                validate(alias);
            } else if (!allowedUse(analysis, node)) {
                throw new Error('Callback options may be mutated or escape static source ownership.');
            }
        }
        compiler.forEachChild(node, visit);
    }
    for (const file of analysis.program.getSourceFiles()) {
        if (!file.isDeclarationFile && !file.fileName.includes('/node_modules/')) {
            visit(file);
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

function validateInitializers(
    analysis: SourceAnalysis,
    symbol: TypeScript.Symbol,
    validate: (node: TypeScript.Node) => void
): void {
    const declarations = symbol.declarations ?? [];
    for (const declaration of declarations) {
        if (exportedStorage(analysis, declaration)) {
            throw new Error('Exported callback options escape static source ownership.');
        }
        const initializer = immutableInitializer(analysis, declaration);
        if (initializer !== undefined) {
            validate(initializer);
        }
    }
}

export function validateCallbackStorage(analysis: SourceAnalysis, initial: TypeScript.Node): void {
    const seen = new Set<TypeScript.Symbol>();
    function validate(input: TypeScript.Node): void {
        const inner = transparentExpression(analysis, input);
        if (inner !== undefined) {
            validate(inner);
            return;
        }
        const symbol = analysis.compiler.isIdentifier(input) ? sourceSymbol(analysis, input) : undefined;
        if (symbol === undefined || seen.has(symbol)) {
            return;
        }
        seen.add(symbol);
        validateInitializers(analysis, symbol, validate);
        validateReferences(analysis, symbol, validate);
    }
    validate(initial);
}
