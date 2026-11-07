import type TypeScript from 'typescript';
import { nativeMatcherBinding } from './native-reference.ts';
import type { SourceAnalysis, SourceBody } from './source-ownership.ts';

function annotatedReceiver(analysis: SourceAnalysis, initial: TypeScript.Expression): TypeScript.Expression {
    const { compiler } = analysis;
    let expression = initial;
    while (
        compiler.isCallExpression(expression) && compiler.isPropertyAccessExpression(expression.expression) &&
        expression.expression.name.text === 'annotated'
    ) {
        expression = expression.expression.expression;
    }
    return expression;
}

function isScope(analysis: SourceAnalysis, node: TypeScript.Node, scope: TypeScript.Identifier): boolean {
    return analysis.compiler.isIdentifier(node) && node.text === scope.text &&
        analysis.checker.getSymbolAtLocation(node) === analysis.checker.getSymbolAtLocation(scope);
}

function scopeTarget(
    analysis: SourceAnalysis,
    initial: TypeScript.Expression,
    scope: TypeScript.Identifier
): string | null {
    let expression = annotatedReceiver(analysis, initial);
    const members: string[] = [];
    while (analysis.compiler.isPropertyAccessExpression(expression)) {
        members.push(expression.name.text);
        expression = annotatedReceiver(analysis, expression.expression);
    }
    return isScope(analysis, expression, scope) ? members.toReversed().join('.') : null;
}

function assertionCall(
    analysis: SourceAnalysis,
    node: TypeScript.Node,
    scope: TypeScript.Identifier
): TypeScript.CallExpression | null {
    if (!analysis.compiler.isCallExpression(node)) {
        return null;
    }
    const target = scopeTarget(analysis, node.expression, scope);
    if (target === 'assert') {
        return node;
    }
    if (target !== null && target !== 'assert.collect') {
        throw new Error(`Unsupported runtime operation in a checker-backed body: scope.${target}`);
    }
    return null;
}

function rejectUnownedReference(analysis: SourceAnalysis, node: TypeScript.Node): void {
    if (
        (analysis.compiler.isIdentifier(node) || analysis.compiler.isPropertyAccessExpression(node)) &&
        nativeMatcherBinding(analysis, node) !== null
    ) {
        throw new Error('Native assertion references require a direct scope.assert boundary.');
    }
}

function allowedScopeUse(analysis: SourceAnalysis, node: TypeScript.Node, scope: TypeScript.Identifier): boolean {
    const { compiler } = analysis;
    if (node === scope || compiler.isTypeQueryNode(node.parent) || compiler.isQualifiedName(node.parent)) {
        return true;
    }
    return compiler.isPropertyAccessExpression(node.parent) && node.parent.expression === node;
}

function boundAssertionUse(analysis: SourceAnalysis, node: TypeScript.Node): boolean {
    const { parent } = node;
    return (analysis.compiler.isCallExpression(parent) || analysis.compiler.isPropertyAccessExpression(parent)) &&
        parent.expression === node;
}

function rejectDetachedAssertion(analysis: SourceAnalysis, node: TypeScript.Node, scope: TypeScript.Identifier): void {
    if (!analysis.compiler.isPropertyAccessExpression(node)) {
        return;
    }
    const target = scopeTarget(analysis, node, scope)?.split('.', 1)[0];
    if (target !== 'assert' && target !== 'require') {
        return;
    }
    if (!boundAssertionUse(analysis, node)) {
        throw new Error('Detached assertion methods are unsupported in checker-backed bodies.');
    }
}

function rejectScopeForwarding(analysis: SourceAnalysis, node: TypeScript.Node, scope: TypeScript.Identifier): void {
    if (isScope(analysis, node, scope) && !allowedScopeUse(analysis, node, scope)) {
        throw new Error('Scope forwarding is unsupported in checker-backed bodies.');
    }
    rejectDetachedAssertion(analysis, node, scope);
}

function rejectNestedAssertions(analysis: SourceAnalysis, node: TypeScript.Node, scope: TypeScript.Identifier): void {
    if (assertionCall(analysis, node, scope) !== null) {
        throw new Error('Nested native assertion boundaries are unsupported.');
    }
    rejectScopeForwarding(analysis, node, scope);
    rejectUnownedReference(analysis, node);
    analysis.compiler.forEachChild(node, function visit(child) {
        rejectNestedAssertions(analysis, child, scope);
    });
}

function validateOperands(
    analysis: SourceAnalysis,
    call: TypeScript.CallExpression,
    scope: TypeScript.Identifier
): void {
    for (const operand of call.arguments.slice(1)) {
        rejectNestedAssertions(analysis, operand, scope);
    }
}

function visitScopeInputs(
    analysis: SourceAnalysis,
    node: TypeScript.Node,
    scope: TypeScript.Identifier,
    visit: (child: TypeScript.Node) => void
): void {
    rejectScopeForwarding(analysis, node, scope);
    rejectUnownedReference(analysis, node);
    analysis.compiler.forEachChild(node, visit);
}

export function scopeAssertions(
    analysis: SourceAnalysis,
    body: SourceBody,
    scope: TypeScript.Identifier
): readonly TypeScript.CallExpression[] {
    const calls: TypeScript.CallExpression[] = [];
    function visit(node: TypeScript.Node): void {
        if (node !== body && analysis.compiler.isFunctionLike(node)) {
            rejectNestedAssertions(analysis, node, scope);
            return;
        }
        const call = assertionCall(analysis, node, scope);
        if (call !== null) {
            calls.push(call);
            validateOperands(analysis, call, scope);
            return;
        }
        visitScopeInputs(analysis, node, scope, visit);
    }
    visit(body);
    return calls;
}

export function assertionAnnotation(analysis: SourceAnalysis, call: TypeScript.CallExpression): string | null {
    const prefix = call.expression;
    if (!analysis.compiler.isCallExpression(prefix)) {
        return null;
    }
    const annotation = prefix.arguments[0];
    if (annotation === undefined || prefix.arguments.length !== 1) {
        throw new Error('Native assertion annotations require one message.');
    }
    const message = analysis.checker.getTypeAtLocation(annotation);
    if (!message.isStringLiteral()) {
        throw new Error('Native assertion annotations require a statically known string message.');
    }
    return message.value;
}
