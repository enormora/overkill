import { AST_NODE_TYPES as NodeType, type TSESTree as Tree } from '@typescript-eslint/utils';
import { match } from 'ts-pattern';
import type { CompositeCheckBuilder } from '../assert/assertion-extension.ts';
import type { BindingAnalysis } from './binding-analysis.ts';
import type { FunctionNode } from './binding-origin.ts';

type Node = Readonly<Tree.Node>;

const builtInChecks = {
    array: true,
    arrayContainsPartial: true,
    between: true,
    boolean: true,
    deepEqual: true,
    defined: true,
    empty: true,
    endsWith: true,
    equal: true,
    fail: true,
    false: true,
    function: true,
    greaterThan: true,
    greaterThanOrEqual: true,
    hasProperty: true,
    includes: true,
    instanceOf: true,
    length: true,
    lessThan: true,
    lessThanOrEqual: true,
    match: true,
    membersPartialDeepEqual: true,
    notDeepEqual: true,
    notEmpty: true,
    notEqual: true,
    notMatch: true,
    notNull: true,
    null: true,
    number: true,
    object: true,
    partialDeepEqual: true,
    rejects: true,
    startsWith: true,
    string: true,
    throws: true,
    true: true,
    undefined: true
} satisfies Record<Exclude<keyof CompositeCheckBuilder, 'annotated' | 'fromRejectable' | 'fromThrowable' | 'group'>, true>;

function propertyName(property: Readonly<Tree.Property>): string | null {
    if (property.key.type === NodeType.Identifier && !property.computed) {
        return property.key.name;
    }
    return property.key.type === NodeType.Literal && typeof property.key.value === 'string'
        ? property.key.value
        : null;
}

function isDefinitionProperty(property: Readonly<Tree.Property | Tree.SpreadElement>): property is Readonly<Tree.Property> {
    if (property.type !== NodeType.Property || property.kind !== 'init') {
        return false;
    }
    const key = propertyName(property);
    return key === 'assert' || key === 'name' && property.value.type === NodeType.Literal &&
        typeof property.value.value === 'string';
}

function assertionBody(factory: Readonly<Tree.CallExpression>, analysis: BindingAnalysis): FunctionNode | null {
    const definition = factory.arguments[0];
    if (definition?.type !== NodeType.ObjectExpression || factory.arguments.length !== 1) {
        return null;
    }
    const properties = definition.properties.filter(isDefinitionProperty);
    if (properties.length !== definition.properties.length) {
        return null;
    }
    const callbacks = properties.filter(function (property) {
        return propertyName(property) === 'assert';
    });
    const callback = callbacks.length === 1 ? callbacks[0] : undefined;
    return localCallback(callback, analysis);
}

function localCallback(property: Readonly<Tree.Property> | undefined, analysis: BindingAnalysis): FunctionNode | null {
    const origin = property === undefined ? null : analysis.originOf(property.value);
    return origin?.root.kind === 'function' && origin.path.length === 0 ? origin.root.node : null;
}

function isLiteral(node: Node): boolean {
    return match(node)
        .with({ type: NodeType.Literal }, function () {
            return true;
        })
        .with({ type: NodeType.UnaryExpression }, function ({ operator, argument }) {
            return (operator === '-' || operator === '+') &&
                argument.type === NodeType.Literal && typeof argument.value === 'number';
        })
        .with({ type: NodeType.ArrayExpression }, function ({ elements }) {
            return elements.every(function (element) {
                return element !== null && isLiteral(element);
            });
        })
        .with({ type: NodeType.ObjectExpression }, function ({ properties }) {
            return properties.every(function (property) {
                return property.type === NodeType.Property && property.kind === 'init' &&
                    propertyName(property) !== null && propertyName(property) !== '__proto__' && isLiteral(property.value);
            });
        })
        .otherwise(function () {
            return false;
        });
}

function staticMember(node: Readonly<Tree.MemberExpression>): boolean {
    return !node.optional &&
        (!node.computed || node.property.type === NodeType.Literal || node.property.type === NodeType.Identifier);
}

function directReference(node: Node): boolean {
    if (node.type === NodeType.Identifier) {
        return true;
    }
    return node.type === NodeType.MemberExpression && staticMember(node) && directReference(node.object);
}

function directBinding(node: Node): boolean {
    if (node.type === NodeType.Identifier) {
        return true;
    }
    if (node.type === NodeType.ObjectPattern) {
        return node.properties.every(function (property) {
            return property.type === NodeType.Property && propertyName(property) !== null &&
                directBinding(property.value);
        });
    }
    return false;
}

function operand(node: Node, body: FunctionNode, analysis: BindingAnalysis): boolean {
    const origin = analysis.originOf(node);
    return isLiteral(node) || directReference(node) &&
        origin?.root.kind === 'parameter' && origin.root.owner === body && origin.root.index > 0;
}

function callOrigin(node: Node, analysis: BindingAnalysis): Readonly<Tree.CallExpression> | null {
    if (node.type !== NodeType.CallExpression && node.type !== NodeType.Identifier) {
        return null;
    }
    const origin = analysis.originOf(node);
    return origin?.root.kind === 'call' && origin.path.length === 0 ? origin.root.node : null;
}

function builderMethod(call: Readonly<Tree.CallExpression>, body: FunctionNode, analysis: BindingAnalysis): string | null {
    if (call.optional || !directReference(call.callee)) {
        return null;
    }
    const method = analysis.originOf(call.callee);
    if (method?.root.kind !== 'parameter') {
        return null;
    }
    return parameterMethod(method.root, body, method.path);
}

function parameterMethod(
    parameter: { readonly owner: FunctionNode; readonly index: number; },
    body: FunctionNode,
    path: readonly string[]
): string | null {
    return parameter.owner === body && parameter.index === 0 && path.length === 1 ? path[0] ?? null : null;
}

function singleGroupChild(call: Readonly<Tree.CallExpression>): Node | null {
    const [ children ] = call.arguments;
    return call.arguments.length === 1 && children?.type === NodeType.ArrayExpression && children.elements.length === 1
        ? children.elements[0] ?? null
        : null;
}

function forwardedCheck(
    node: Node,
    body: FunctionNode,
    analysis: BindingAnalysis,
    returnedCalls: Set<Node>
): string | null {
    const call = callOrigin(node, analysis);
    if (call === null || returnedCalls.has(call)) {
        return null;
    }
    const name = builderMethod(call, body, analysis);
    if (name === null) {
        return null;
    }
    returnedCalls.add(call);
    return returnedCheck(name, call, body, { analysis, returnedCalls });
}

function returnedCheck(
    name: string,
    call: Readonly<Tree.CallExpression>,
    body: FunctionNode,
    context: { readonly analysis: BindingAnalysis; readonly returnedCalls: Set<Node>; }
): string | null {
    const { analysis, returnedCalls } = context;
    if (name === 'group') {
        const child = singleGroupChild(call);
        return child === null ? null : forwardedCheck(child, body, analysis, returnedCalls);
    }
    return Object.hasOwn(builtInChecks, name) && call.arguments.every(function (argument) {
        return operand(argument, body, analysis);
    }) ? name : null;
}

function transparentDeclaration(
    statement: Node,
    body: FunctionNode,
    analysis: BindingAnalysis,
    returnedCalls: ReadonlySet<Node>
): boolean {
    return statement.type === NodeType.VariableDeclaration && statement.kind === 'const' &&
        statement.declarations.every(function ({ id, init }) {
            if (init === null || !directBinding(id)) {
                return false;
            }
            return isLiteral(init) || forwardsInitializer(init, body, analysis, returnedCalls);
        });
}

function forwardsInitializer(node: Node, body: FunctionNode, analysis: BindingAnalysis, returnedCalls: ReadonlySet<Node>): boolean {
    if (directReference(node)) {
        const origin = analysis.originOf(node);
        if (origin?.root.kind === 'parameter') {
            return origin.root.owner === body;
        }
    }
    const call = callOrigin(node, analysis);
    return call !== null && returnedCalls.has(call);
}

function unawaited(node: Node | null): Node | null {
    return node?.type === NodeType.AwaitExpression ? node.argument : node;
}

function returnedExpression(body: FunctionNode): { readonly statements: readonly Node[]; readonly result: Node | null; } {
    if (body.body.type !== NodeType.BlockStatement) {
        return { statements: [], result: unawaited(body.body) };
    }
    const { body: statements } = body.body;
    const last = statements.at(-1);
    return {
        statements: statements.slice(0, -1),
        result: last?.type === NodeType.ReturnStatement ? unawaited(last.argument) : null
    };
}

function forwardingBody(factory: Readonly<Tree.CallExpression>, analysis: BindingAnalysis): FunctionNode | null {
    const body = assertionBody(factory, analysis);
    return body === null || body.generator || !body.params.every(directBinding) ? null : body;
}

export function forwardedBuiltIn(factory: Readonly<Tree.CallExpression>, analysis: BindingAnalysis): string | null {
    const body = forwardingBody(factory, analysis);
    return body === null ? null : forwardedBody(body, analysis);
}

function forwardedBody(body: FunctionNode, analysis: BindingAnalysis): string | null {
    const { statements, result } = returnedExpression(body);
    if (result === null) {
        return null;
    }
    const returnedCalls = new Set<Node>();
    const check = forwardedCheck(result, body, analysis, returnedCalls);
    return check !== null && confirmsForwarding(body, statements, check, { analysis, returnedCalls }) ? check : null;
}

function confirmsForwarding(
    body: FunctionNode,
    statements: readonly Node[],
    check: string,
    context: { readonly analysis: BindingAnalysis; readonly returnedCalls: ReadonlySet<Node>; }
): boolean {
    if (body.async && check !== 'rejects') {
        return false;
    }
    return statements.every(function (statement) {
        return transparentDeclaration(statement, body, context.analysis, context.returnedCalls);
    });
}
