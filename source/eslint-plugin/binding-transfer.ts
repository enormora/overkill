import { match } from 'ts-pattern';
import { AST_NODE_TYPES as NodeType, type TSESTree as Tree } from '@typescript-eslint/utils';
import {
    type Allocation,
    allocationsOf,
    alternatives,
    possibleValues,
    originValue,
    type BindingValues,
    bindingValues,
    forgetObject,
    propertyOf,
    type State,
    type Value,
    type Variable
} from './binding-state.ts';
import { isFunction } from './binding-origin.ts';

export type Variables = ReadonlyMap<Tree.Node, Variable>;

function literalKey(node: Readonly<Tree.Node>): string | undefined {
    if (node.type !== NodeType.Literal) {
        return undefined;
    }
    const { value } = node;
    return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;
}

function propertyKey(state: State, node: Readonly<Tree.Node>, computed: boolean): string | undefined {
    if (!computed && node.type === NodeType.Identifier) {
        return node.name;
    }
    const value = state.expressions.get(node);
    return value?.kind === 'key' ? value.key : literalKey(node);
}

function isArrayObject(value: Value | undefined): boolean {
    return value?.kind === 'object' && value.allocation.type === NodeType.ArrayExpression;
}

function writableProperty(receiver: Value | undefined, key: string): boolean {
    if (key === '__proto__' || receiver?.kind === 'possible-objects') {
        return false;
    }
    return key !== 'length' || !isArrayObject(receiver);
}

function writeMember(state: State, target: Readonly<Tree.MemberExpression>, value: Value | undefined): void {
    const receiver = state.expressions.get(target.object);
    const key = propertyKey(state, target.property, target.computed);
    if (key === undefined || !writableProperty(receiver, key)) {
        forgetObject(state, receiver);
        forgetObject(state, value);
        return;
    }
    const properties = receiver?.kind === 'object' ? state.objects.get(receiver.allocation) : undefined;
    if (properties === undefined) {
        forgetObject(state, value);
    } else {
        properties.store(key, value);
    }
}

export function bindPattern(
    state: State,
    variables: Variables,
    target: Tree.Node,
    value: Value | undefined
): void {
    match(target)
        .with({ type: NodeType.Identifier }, function (matched) {
            const variable = variables.get(matched);
            if (variable === undefined) {
                forgetObject(state, value);
            } else {
                state.bindings.store(variable, value);
            }
        })
        .with({ type: NodeType.MemberExpression }, function (matched) {
            writeMember(state, matched, value);
        })
        .with({ type: NodeType.ObjectPattern }, function (matched) {
            for (const property of matched.properties) {
                if (property.type === NodeType.RestElement) {
                    forgetObject(state, propertyOf(state, value, undefined));
                    bindPattern(state, variables, property.argument, undefined);
                } else {
                    const key = propertyKey(state, property.key, property.computed);
                    bindPattern(state, variables, property.value, propertyOf(state, value, key));
                }
            }
        })
        .with({ type: NodeType.ArrayPattern }, function (matched) {
            for (const [ index, element ] of matched.elements.entries()) {
                if (element !== null) {
                    bindPattern(state, variables, element, propertyOf(state, value, String(index)));
                }
            }
        })
        .with({ type: NodeType.AssignmentPattern }, function (matched) {
            bindPattern(state, variables, matched.left, undefined);
        })
        .with({ type: NodeType.RestElement }, function (matched) {
            bindPattern(state, variables, matched.argument, undefined);
        })
        .otherwise(function () {
            return undefined;
        });
}

function allocateObject(state: State, node: Allocation, properties: ReadonlyMap<string, Value>): Value | undefined {
    state.expressions.store(node, undefined);
    function aliasesAllocation(value: Value): boolean {
        return Array.from(allocationsOf(value)).includes(node);
    }
    if (
        Array.from(state.bindings.values()).some(aliasesAllocation) ||
        Array.from(state.objects.values()).some(function (fields) {
            return Array.from(fields.values()).some(aliasesAllocation);
        })
    ) {
        forgetObject(state, { kind: 'object', allocation: node });
    } else {
        state.setObject(node, bindingValues(properties));
    }
    return { kind: 'object', allocation: node };
}

function propertyValue(state: State, property: Readonly<Tree.Property | Tree.SpreadElement>): Value | undefined {
    const expression = property.type === NodeType.SpreadElement ? property.argument : property.value;
    return state.expressions.get(expression);
}

function isOpaqueProperty(state: State, property: Readonly<Tree.Property | Tree.SpreadElement>): boolean {
    return property.type === NodeType.Property &&
        (property.kind !== 'init' || propertyKey(state, property.key, property.computed) === '__proto__');
}

function clearOpaqueProperties(state: State, properties: BindingValues<string>): void {
    const entries = Array.from(properties);
    for (const [ key, value ] of entries) {
        forgetObject(state, value);
        properties.store(key, undefined);
    }
}

function spreadProperties(state: State, value: Value | undefined, target: BindingValues<string>): boolean {
    if (!state.trackAlternatives || value?.kind !== 'object') {
        return false;
    }
    const source = state.objects.get(value.allocation);
    if (source === undefined) {
        return false;
    }
    for (const [ key, field ] of source) {
        target.store(key, field);
    }
    return true;
}

function storeProperty(
    state: State,
    properties: BindingValues<string>,
    property: Readonly<Tree.Property | Tree.SpreadElement>
): void {
    const key = property.type === NodeType.Property ? propertyKey(state, property.key, property.computed) : undefined;
    const value = propertyValue(state, property);
    if (property.type === NodeType.SpreadElement && spreadProperties(state, value, properties)) {
        return;
    }
    if (key === undefined) {
        forgetObject(state, value);
        clearOpaqueProperties(state, properties);
    } else {
        properties.store(key, value);
    }
}

function dataProperties(
    state: State,
    fields: readonly (Tree.Property | Tree.SpreadElement)[]
): ReadonlyMap<string, Value> {
    const properties = bindingValues<string>(new Map());
    for (const property of fields) {
        storeProperty(state, properties, property);
    }
    return properties;
}

function objectLiteral(state: State, node: Readonly<Tree.ObjectExpression>): Value | undefined {
    const opaque = node.properties.some(function (property) {
        return isOpaqueProperty(state, property);
    });
    if (opaque) {
        for (const property of node.properties) {
            forgetObject(state, propertyValue(state, property));
        }
        return undefined;
    }
    return allocateObject(state, node, dataProperties(state, node.properties));
}

function arrayLiteral(state: State, node: Readonly<Tree.ArrayExpression>): Value | undefined {
    const spreadIndex = node.elements.findIndex(function (element) {
        return element?.type === NodeType.SpreadElement;
    });
    const knownLength = spreadIndex === -1 ? node.elements.length : spreadIndex;
    const properties = bindingValues<string>(new Map());
    node.elements.slice(0, knownLength).forEach(function (element, index) {
        if (element !== null) {
            properties.store(String(index), state.expressions.get(element));
        }
    });
    node.elements.slice(knownLength).forEach(function (element) {
        if (element !== null) {
            const source = element.type === NodeType.SpreadElement ? element.argument : element;
            forgetObject(state, state.expressions.get(source));
        }
    });
    return allocateObject(state, node, properties);
}

function assignedValue(state: State, node: Tree.AssignmentExpression): Value | undefined {
    return node.operator === '=' ? state.expressions.get(node.right) : undefined;
}

function callResult(state: State, call: Tree.CallExpression): Value | undefined {
    const callee = state.expressions.get(call.callee);
    const annotated = alternatives(callee).flatMap(function (value) {
        if (value.kind !== 'origin' || value.origin.root.kind !== 'parameter') {
            return [];
        }
        const { root, path } = value.origin;
        if (path.length === 2 && (path[0] === 'assert' || path[0] === 'require') && path[1] === 'annotated') {
            return [ originValue(root, path.slice(0, -1)) ];
        }
        if (path.at(-1) === 'bind' && (path[0] === 'assert' || path[0] === 'require' || path[0] === 'plan')) {
            return [ originValue(root, path.slice(0, -1)) ];
        }
        return [];
    });
    return callee?.kind === 'alternatives'
        ? possibleValues(annotated)
        : annotated[0] ?? originValue({ kind: 'call', node: call }, []);
}

function expressionValue(state: State, variables: Variables, node: Tree.Node): Value | undefined {
    return match(node)
        .with({ type: NodeType.Identifier }, function (matched) {
            const variable = variables.get(matched);
            return variable === undefined ? undefined : state.bindings.get(variable);
        })
        .with({ type: NodeType.Literal }, function (matched) {
            return typeof matched.value === 'string' || typeof matched.value === 'number'
                ? { kind: 'key' as const, key: String(matched.value) }
                : undefined;
        })
        .with({ type: NodeType.MemberExpression }, function (matched) {
            return propertyOf(
                state,
                state.expressions.get(matched.object),
                propertyKey(state, matched.property, matched.computed)
            );
        })
        .with({ type: NodeType.ConditionalExpression }, { type: NodeType.LogicalExpression }, function (matched) {
            return state.expressions.get(matched);
        })
        .with({ type: NodeType.CallExpression }, function (matched) {
            return callResult(state, matched);
        })
        .with({ type: NodeType.AssignmentExpression }, function (matched) {
            return assignedValue(state, matched);
        })
        .with({ type: NodeType.ArrayExpression }, function (matched) {
            return arrayLiteral(state, matched);
        })
        .with({ type: NodeType.ObjectExpression }, function (matched) {
            return objectLiteral(state, matched);
        })
        .with(
            { type: NodeType.TSAsExpression },
            { type: NodeType.TSInstantiationExpression },
            { type: NodeType.TSNonNullExpression },
            { type: NodeType.TSSatisfiesExpression },
            { type: NodeType.TSTypeAssertion },
            { type: NodeType.ChainExpression },
            function (matched) {
                return state.expressions.get(matched.expression);
            }
        )
        .with({ type: NodeType.SequenceExpression }, function (matched) {
            const last = matched.expressions.at(-1);
            return last === undefined ? undefined : state.expressions.get(last);
        })
        .otherwise(function (matched) {
            return isFunction(matched)
                ? { kind: 'origin', origin: { root: { kind: 'function', node: matched }, path: [] } }
                : undefined;
        });
}

function escapeArguments(
    state: State,
    node: Tree.CallExpression | Tree.NewExpression,
    captured: ReadonlySet<Variable>
): void {
    for (const argument of node.arguments) {
        forgetObject(
            state,
            state.expressions.get(argument.type === NodeType.SpreadElement ? argument.argument : argument)
        );
    }
    if (node.callee.type === NodeType.MemberExpression) {
        forgetObject(state, state.expressions.get(node.callee.object));
    }
    for (const variable of captured) {
        forgetObject(state, state.bindings.get(variable));
    }
}

export function bindIteration(
    state: State,
    variables: Variables,
    node: Tree.ForInStatement | Tree.ForOfStatement
): void {
    if (node.left.type === NodeType.VariableDeclaration) {
        for (const declaration of node.left.declarations) {
            bindPattern(state, variables, declaration.id, undefined);
        }
    } else {
        bindPattern(state, variables, node.left, undefined);
    }
}

function branchResult(node: Readonly<Tree.Node>): Tree.Node | undefined {
    return match(node.parent)
        .with({ type: NodeType.ConditionalExpression }, function (parent) {
            return parent.consequent === node || parent.alternate === node ? parent : undefined;
        })
        .with({ type: NodeType.LogicalExpression }, function (parent) {
            return parent.left === node || parent.right === node ? parent : undefined;
        })
        .otherwise(function () {
            return undefined;
        });
}

export function transfer(
    state: State,
    variables: Variables,
    captured: ReadonlySet<Variable>,
    node: Tree.Node
): void {
    const value = expressionValue(state, variables, node);
    state.expressions.store(node, value);
    const result = branchResult(node);
    if (result !== undefined) {
        state.expressions.store(result, value);
    }
    match(node)
        .with({ type: NodeType.VariableDeclarator }, function (matched) {
            if (matched.init !== null) {
                bindPattern(state, variables, matched.id, state.expressions.get(matched.init));
            }
        })
        .with({ type: NodeType.AssignmentExpression }, function (matched) {
            bindPattern(state, variables, matched.left, value);
        })
        .with({ type: NodeType.UpdateExpression }, function (matched) {
            bindPattern(state, variables, matched.argument, undefined);
        })
        .with({ type: NodeType.UnaryExpression }, function (matched) {
            if (matched.operator === 'delete') {
                bindPattern(state, variables, matched.argument, undefined);
            }
        })
        .with({ type: NodeType.CallExpression }, { type: NodeType.NewExpression }, function (matched) {
            escapeArguments(state, matched, captured);
        })
        .with({ type: NodeType.ReturnStatement }, { type: NodeType.ThrowStatement }, function (matched) {
            if (matched.argument !== null) {
                forgetObject(state, state.expressions.get(matched.argument));
            }
        })
        .otherwise(function () {
            return undefined;
        });
}
