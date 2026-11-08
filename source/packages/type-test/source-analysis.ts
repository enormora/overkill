import type TypeScript from 'typescript';

export type SourceAnalysis = {
    readonly compiler: typeof TypeScript;
    readonly checker: TypeScript.TypeChecker;
    readonly program: TypeScript.Program;
};

function referencedSymbol(analysis: SourceAnalysis, node: TypeScript.Node): TypeScript.Symbol | undefined {
    const location = analysis.compiler.isIdentifier(node) ? node.parent : node;
    return analysis.compiler.isShorthandPropertyAssignment(location)
        ? analysis.checker.getShorthandAssignmentValueSymbol(location)
        : analysis.checker.getSymbolAtLocation(node);
}

export function sourceSymbol(analysis: SourceAnalysis, node: TypeScript.Node): TypeScript.Symbol | undefined {
    const symbol = referencedSymbol(analysis, node);
    return symbol?.flags === analysis.compiler.SymbolFlags.Alias ? analysis.checker.getAliasedSymbol(symbol) : symbol;
}

export function immutableInitializer(analysis: SourceAnalysis, node: TypeScript.Node): TypeScript.Node | undefined {
    const { compiler } = analysis;
    if (!compiler.isVariableDeclaration(node) || !compiler.isVariableDeclarationList(node.parent)) {
        return undefined;
    }
    return node.parent.getFirstToken()?.kind === compiler.SyntaxKind.ConstKeyword ? node.initializer : undefined;
}

export function transparentExpression(analysis: SourceAnalysis, node: TypeScript.Node): TypeScript.Node | undefined {
    const { compiler } = analysis;
    if (
        compiler.isParenthesizedExpression(node) || compiler.isAsExpression(node) ||
        compiler.isTypeAssertionExpression(node) || compiler.isSatisfiesExpression(node) ||
        compiler.isExpressionWithTypeArguments(node)
    ) {
        return node.expression;
    }
    return undefined;
}

function assignmentTarget(analysis: SourceAnalysis, node: TypeScript.Node): TypeScript.Node | undefined {
    if (!analysis.compiler.isBinaryExpression(node)) {
        return undefined;
    }
    const { kind } = node.operatorToken;
    return kind >= analysis.compiler.SyntaxKind.FirstAssignment && kind <= analysis.compiler.SyntaxKind.LastAssignment
        ? node.left
        : undefined;
}

function bindingAssignment(analysis: SourceAnalysis, node: TypeScript.Node): boolean {
    let { parent } = node;
    while (!analysis.compiler.isSourceFile(parent)) {
        if (analysis.compiler.isTypeNode(parent)) {
            return false;
        }
        const target = assignmentTarget(analysis, parent);
        if (target !== undefined && target.pos <= node.pos && node.end <= target.end) {
            return true;
        }
        parent = parent.parent;
    }
    return false;
}

export function validateFunctionBinding(analysis: SourceAnalysis, name: TypeScript.Node): void {
    const symbol = sourceSymbol(analysis, name);
    if (symbol === undefined) {
        throw new Error('Cannot establish callback function binding.');
    }
    function visit(node: TypeScript.Node): void {
        if (
            analysis.compiler.isIdentifier(node) && sourceSymbol(analysis, node) === symbol &&
            bindingAssignment(analysis, node)
        ) {
            throw new Error('Callback function bindings cannot be reassigned.');
        }
        analysis.compiler.forEachChild(node, visit);
    }
    const declarations = symbol.declarations ?? [];
    const files = new Set(declarations.map(function declarationFile(declaration) {
        return declaration.getSourceFile();
    }));
    for (const file of files) {
        if (!file.isDeclarationFile) {
            visit(file);
        }
    }
}
