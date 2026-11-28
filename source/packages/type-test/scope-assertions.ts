import type * as TypeScript from 'typescript-beta/ast';
import type { SourceAnalysis } from './source-analysis-port.ts';
import { UnsupportedEvidenceError } from './unsupported-evidence-error.ts';
import { sourceSymbol, sourceChildren } from './source-analysis.ts';
import { typesMember } from './native-reference.ts';
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
    scope: TypeScript.Identifier | null
): Promise<boolean> {
    return scope !== null && analysis.compiler.isIdentifier(node) && node.text === scope.text &&
        await sourceSymbol(analysis, node) === await sourceSymbol(analysis, scope);
}
async function scopeTarget(
    analysis: SourceAnalysis,
    initial: TypeScript.Expression,
    scope: TypeScript.Identifier | null
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
    scope: TypeScript.Identifier | null
): Promise<TypeScript.CallExpression | null> {
    if (!analysis.compiler.isCallExpression(node)) {
        return null;
    }
    const target = await scopeTarget(analysis, node.expression, scope);
    if (target === 'assert') {
        return node;
    }
    if (target !== null && target !== 'assert.collect') {
        throw new UnsupportedEvidenceError(
            `Unsupported runtime operation in a checker-backed body: scope.${target}`,
            undefined
        );
    }
    return null;
}
async function rejectUnownedReference(analysis: SourceAnalysis, node: TypeScript.Node): Promise<void> {
    if (
        (analysis.compiler.isIdentifier(node) || analysis.compiler.isPropertyAccessExpression(node)) &&
        await typesMember(analysis, node) !== null
    ) {
        throw new UnsupportedEvidenceError(
            'Native assertion references require a direct scope.assert boundary.',
            undefined
        );
    }
}
function allowedScopeUse(
    analysis: SourceAnalysis,
    node: TypeScript.Node,
    scope: TypeScript.Identifier | null
): boolean {
    const { compiler } = analysis;
    if (
        compiler.isIdentifier(node) && node === scope || compiler.isTypeQueryNode(node.parent) ||
        compiler.isQualifiedName(node.parent)
    ) {
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
    scope: TypeScript.Identifier | null
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
        throw new UnsupportedEvidenceError(
            'Detached assertion methods are unsupported in checker-backed bodies.',
            undefined
        );
    }
}
async function rejectScopeForwarding(
    analysis: SourceAnalysis,
    node: TypeScript.Node,
    scope: TypeScript.Identifier | null
): Promise<void> {
    if (await isScope(analysis, node, scope) && !allowedScopeUse(analysis, node, scope)) {
        throw new UnsupportedEvidenceError('Scope forwarding is unsupported in checker-backed bodies.', undefined);
    }
    await rejectDetachedAssertion(analysis, node, scope);
}
async function rejectNestedAssertions(
    analysis: SourceAnalysis,
    node: TypeScript.Node,
    scope: TypeScript.Identifier | null
): Promise<void> {
    if (await assertionCall(analysis, node, scope) !== null) {
        throw new UnsupportedEvidenceError('Nested native assertion boundaries are unsupported.', undefined);
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
    scope: TypeScript.Identifier | null
): Promise<void> {
    for (const operand of call.arguments.slice(1)) {
        await rejectNestedAssertions(analysis, operand, scope);
    }
}
async function checkedScopeNode(
    analysis: SourceAnalysis,
    node: TypeScript.Node,
    scope: TypeScript.Identifier | null
): Promise<TypeScript.CallExpression | null> {
    const call = await assertionCall(analysis, node, scope);
    if (call === null) {
        await rejectScopeForwarding(analysis, node, scope);
        await rejectUnownedReference(analysis, node);
        return null;
    }
    await validateOperands(analysis, call, scope);
    return call;
}

export async function scopeAssertions(
    analysis: SourceAnalysis,
    body: SourceBody,
    scope: TypeScript.Identifier | null,
    unsupported: (node: TypeScript.Node, error: UnsupportedEvidenceError) => void
): Promise<readonly TypeScript.CallExpression[]> {
    const calls: TypeScript.CallExpression[] = [];
    async function inspect(
        node: TypeScript.Node
    ): Promise<TypeScript.CallExpression | null | undefined> {
        try {
            return await checkedScopeNode(analysis, node, scope);
        } catch (error: unknown) {
            if (!(error instanceof UnsupportedEvidenceError)) {
                throw error;
            }
            unsupported(node, error);
            return undefined;
        }
    }
    async function visit(node: TypeScript.Node): Promise<void> {
        const call = await inspect(node);
        if (call === undefined) {
            return;
        }
        if (call !== null) {
            calls.push(call);
            return;
        }
        for (const child of sourceChildren(node)) {
            await visit(child);
        }
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
        throw new UnsupportedEvidenceError('Native assertion annotations require one message.', undefined);
    }
    const message = await analysis.checker.staticString(annotation);
    if (message === null) {
        throw new UnsupportedEvidenceError(
            'Native assertion annotations require a statically known string message.',
            undefined
        );
    }
    return message;
}
