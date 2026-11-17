import type * as TypeScript from 'typescript-beta/ast';
import { sourceSymbol, sourceChildren, type SourceAnalysis } from './source-analysis.ts';
import { nativeMatcherBinding } from './native-reference.ts';
import type { SourceBody } from './source-ownership.ts';

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

async function isScope(
    analysis: SourceAnalysis,
    node: TypeScript.Node,
    scope: TypeScript.Identifier
): Promise<boolean> {
    return analysis.compiler.isIdentifier(node) && node.text === scope.text &&
        await sourceSymbol(analysis, node) === await sourceSymbol(analysis, scope);
}

async function scopeTarget(
    analysis: SourceAnalysis,
    initial: TypeScript.Expression,
    scope: TypeScript.Identifier
): Promise<string | null> {
    let expression = annotatedReceiver(analysis, initial);
    const members: string[] = [];
    while (analysis.compiler.isPropertyAccessExpression(expression)) {
        members.push(expression.name.text);
        expression = annotatedReceiver(analysis, expression.expression);
    }
    return await isScope(analysis, expression, scope) ? members.toReversed().join('.') : null;
}

async function assertionCall(
    analysis: SourceAnalysis,
    node: TypeScript.Node,
    scope: TypeScript.Identifier
): Promise<TypeScript.CallExpression | null> {
    if (!analysis.compiler.isCallExpression(node)) {
        return null;
    }
    const target = await scopeTarget(analysis, node.expression, scope);
    if (target === 'assert') {
        return node;
    }
    if (target !== null && target !== 'assert.collect') {
        throw new Error(`Unsupported runtime operation in a checker-backed body: scope.${target}`);
    }
    return null;
}

async function rejectUnownedReference(analysis: SourceAnalysis, node: TypeScript.Node): Promise<void> {
    if (
        (analysis.compiler.isIdentifier(node) || analysis.compiler.isPropertyAccessExpression(node)) &&
        await nativeMatcherBinding(analysis, node) !== null
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

async function rejectDetachedAssertion(
    analysis: SourceAnalysis,
    node: TypeScript.Node,
    scope: TypeScript.Identifier
): Promise<void> {
    if (!analysis.compiler.isPropertyAccessExpression(node)) {
        return;
    }
    const path = await scopeTarget(analysis, node, scope);
    const target = path?.split('.', 1)[0];
    if (target !== 'assert' && target !== 'require') {
        return;
    }
    if (!boundAssertionUse(analysis, node)) {
        throw new Error('Detached assertion methods are unsupported in checker-backed bodies.');
    }
}

async function rejectScopeForwarding(
    analysis: SourceAnalysis,
    node: TypeScript.Node,
    scope: TypeScript.Identifier
): Promise<void> {
    if (await isScope(analysis, node, scope) && !allowedScopeUse(analysis, node, scope)) {
        throw new Error('Scope forwarding is unsupported in checker-backed bodies.');
    }
    await rejectDetachedAssertion(analysis, node, scope);
}

async function rejectNestedAssertions(
    analysis: SourceAnalysis,
    node: TypeScript.Node,
    scope: TypeScript.Identifier
): Promise<void> {
    if (await assertionCall(analysis, node, scope) !== null) {
        throw new Error('Nested native assertion boundaries are unsupported.');
    }
    await rejectScopeForwarding(analysis, node, scope);
    await rejectUnownedReference(analysis, node);
    for (const child of sourceChildren(node)) {
        await rejectNestedAssertions(analysis, child, scope);
    }
}

async function validateOperands(
    analysis: SourceAnalysis,
    call: TypeScript.CallExpression,
    scope: TypeScript.Identifier
): Promise<void> {
    for (const operand of call.arguments.slice(1)) {
        await rejectNestedAssertions(analysis, operand, scope);
    }
}

async function visitScopeInputs(
    analysis: SourceAnalysis,
    node: TypeScript.Node,
    scope: TypeScript.Identifier,
    visit: (child: TypeScript.Node) => Promise<void>
): Promise<void> {
    await rejectScopeForwarding(analysis, node, scope);
    await rejectUnownedReference(analysis, node);
    for (const child of sourceChildren(node)) {
        await visit(child);
    }
}

export async function scopeAssertions(
    analysis: SourceAnalysis,
    body: SourceBody,
    scope: TypeScript.Identifier
): Promise<readonly TypeScript.CallExpression[]> {
    const calls: TypeScript.CallExpression[] = [];
    async function visit(node: TypeScript.Node): Promise<void> {
        if (node !== body && analysis.compiler.isFunctionLike(node)) {
            await rejectNestedAssertions(analysis, node, scope);
            return;
        }
        const call = await assertionCall(analysis, node, scope);
        if (call !== null) {
            calls.push(call);
            await validateOperands(analysis, call, scope);
            return;
        }
        await visitScopeInputs(analysis, node, scope, visit);
    }
    await visit(body);
    return calls;
}

export async function assertionAnnotation(
    analysis: SourceAnalysis,
    call: TypeScript.CallExpression
): Promise<string | null> {
    const prefix = call.expression;
    if (!analysis.compiler.isCallExpression(prefix)) {
        return null;
    }
    const annotation = prefix.arguments[0];
    if (annotation === undefined || prefix.arguments.length !== 1) {
        throw new Error('Native assertion annotations require one message.');
    }
    const message = await analysis.checker.getTypeAtLocation(annotation);
    if (!message.isStringLiteralType()) {
        throw new Error('Native assertion annotations require a statically known string message.');
    }
    return message.value;
}
