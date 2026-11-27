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
import { type BindingOrigin, isFunction } from './binding-origin.ts';
import { branchResult, fieldRead, ownFields, propertyKey, recordFields, recordOperand } from './binding-expressions.ts';
import type { OperandSlot } from './operand-identity.ts';

export type Variables = ReadonlyMap<Tree.Node, Variable>;

function isArrayObject(value: Value | undefined): boolean {
    return value?.kind === 'object' && value.allocation.type === NodeType.ArrayExpression;
}

function writableProperty(receiver: Value | undefined, key: string): boolean {
    if (key === '__proto__' || receiver?.kind === 'possible-objects') {
        return false;
    }
    return key !== 'length' || !isArrayObject(receiver);
}

type BindingInput = {
    readonly value: Value | undefined;
    readonly source: OperandSlot | null;
};

const unknownInput: BindingInput = { value: undefined, source: null };

function recordMemberWrite(state: State, origin: Value | undefined, key: string | undefined): void {
    if (state.operands === null || origin?.kind !== 'origin' || origin.origin.root.kind !== 'parameter') {
        return;
    }
    const receiver = origin.origin;
    const write = key === undefined ? receiver : { ...receiver, path: [ ...receiver.path, key ] };
    state.operands.writeOrigin(write);
}

function writeFieldIdentity(state: State, receiver: Value | undefined, key: string, input: BindingInput): void {
    const slot = fieldRead(state, receiver, key);
    if (slot !== null) {
        state.operands?.identity.assign(slot, input.source);
    } else if (state.operands !== null) {
        forgetObject(state, input.value);
    }
}

function writeOwnField(state: State, receiver: Value | undefined, key: string, input: BindingInput): void {
    const properties = receiver?.kind === 'object' ? state.objects.get(receiver.allocation) : undefined;
    if (properties === undefined) {
        forgetObject(state, input.value);
        return;
    }
    properties.store(key, input.value);
    writeFieldIdentity(state, receiver, key, input);
}

function writeMember(state: State, target: Readonly<Tree.MemberExpression>, input: BindingInput): void {
    const receiver = state.expressions.get(target.object);
    const key = propertyKey(state, target.property, target.computed);
    recordMemberWrite(state, receiver, key);
    if (key === undefined || !writableProperty(receiver, key)) {
        forgetObject(state, receiver);
        forgetObject(state, input.value);
    } else {
        writeOwnField(state, receiver, key, input);
    }
}

export function bindPattern(
    state: State,
    variables: Variables,
    target: Tree.Node,
    input: BindingInput
): void {
    const { value, source } = input;
    match(target)
        .with({ type: NodeType.Identifier }, function (matched) {
            const variable = variables.get(matched);
            if (variable === undefined) {
                forgetObject(state, value);
            } else {
                state.bindings.store(variable, value);
                state.operands?.identity.assign(variable, source);
            }
        })
        .with({ type: NodeType.MemberExpression }, function (matched) {
            writeMember(state, matched, input);
        })
        .with({ type: NodeType.ObjectPattern }, function (matched) {
            for (const property of matched.properties) {
                if (property.type === NodeType.RestElement) {
                    forgetObject(state, propertyOf(state, value, undefined));
                    bindPattern(state, variables, property.argument, unknownInput);
                } else {
                    const key = propertyKey(state, property.key, property.computed);
                    bindPattern(state, variables, property.value, {
                        value: propertyOf(state, value, key),
                        source: fieldRead(state, value, key)
                    });
                }
            }
        })
        .with({ type: NodeType.ArrayPattern }, function (matched) {
            for (const [ index, element ] of matched.elements.entries()) {
                if (element !== null) {
                    bindPattern(state, variables, element, {
                        value: propertyOf(state, value, String(index)),
                        source: null
                    });
                }
            }
        })
        .with({ type: NodeType.AssignmentPattern }, function (matched) {
            bindPattern(state, variables, matched.left, unknownInput);
        })
        .with({ type: NodeType.RestElement }, function (matched) {
            bindPattern(state, variables, matched.argument, unknownInput);
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
    const value = allocateObject(state, node, dataProperties(state, node.properties));
    if (state.operands !== null) {
        recordFields(state, node, ownFields(state, node));
    }
    return value;
}

function recordArrayFields(state: State, node: Readonly<Tree.ArrayExpression>, knownLength: number): void {
    if (state.operands === null) {
        return;
    }
    const fields = new Map<string, Tree.Node>();
    node.elements.slice(0, knownLength).forEach(function (element, index) {
        if (element !== null) {
            fields.set(String(index), element);
        }
    });
    recordFields(state, node, fields);
}

function assignedValue(state: State, node: Tree.AssignmentExpression): Value | undefined {
    return node.operator === '=' ? state.expressions.get(node.right) : undefined;
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
    const value = allocateObject(state, node, properties);
    recordArrayFields(state, node, knownLength);
    return value;
}

const facadeMembers = new Set([ 'assert', 'require' ]);
const bindableMembers = new Set([ ...facadeMembers, 'plan' ]);
const facadeMethodPathLength = 2;
const scopeBindPathLength = 3;

function derivesFacade(path: readonly string[]): boolean {
    const [ member, method ] = path;
    return member !== undefined && facadeMembers.has(member) &&
        path.length === facadeMethodPathLength && method === 'annotated';
}

function derivesBoundMethod(path: readonly string[]): boolean {
    const [ member ] = path;
    return member !== undefined && bindableMembers.has(member) && path.at(-1) === 'bind';
}

function withBoundOperands(call: Readonly<Tree.CallExpression>): boolean {
    return call.arguments.length > 1 || call.arguments[0]?.type === NodeType.SpreadElement;
}

function isScopeBind(path: readonly string[]): boolean {
    const [ facade, , method ] = path;
    return facade !== undefined && facadeMembers.has(facade) && path.length === scopeBindPathLength &&
        method === 'bind';
}

function bindKind(state: State, path: readonly string[]): 'builder' | 'scope' | null {
    if (state.operands === null) {
        return derivesBoundMethod(path) ? 'scope' : null;
    }
    if (path.length === facadeMethodPathLength && path[1] === 'bind') {
        return 'builder';
    }
    return isScopeBind(path) ? 'scope' : null;
}

function boundMethod(state: State, origin: BindingOrigin, call: Readonly<Tree.CallExpression>): BindingOrigin | null {
    const { path } = origin;
    const kind = bindKind(state, path);
    return kind === null ? null : {
        ...origin,
        builderOnly: origin.builderOnly || kind === 'builder',
        preboundOperands: origin.preboundOperands || state.operands !== null && withBoundOperands(call),
        path: path.slice(0, -1)
    };
}

function derivedMethod(state: State, origin: BindingOrigin, call: Readonly<Tree.CallExpression>): BindingOrigin | null {
    const { path } = origin;
    const builderAnnotation = path.length === 1 && path[0] === 'annotated';
    if (state.operands !== null && builderAnnotation) {
        return { ...origin, builderOnly: true, path: [] };
    }
    if (derivesFacade(path)) {
        return { ...origin, path: path.slice(0, -1) };
    }
    return boundMethod(state, origin, call);
}

function callResult(state: State, call: Tree.CallExpression): Value | undefined {
    const callee = state.expressions.get(call.callee);
    const derived = alternatives(callee).flatMap(function (value) {
        if (value.kind !== 'origin' || value.origin.root.kind !== 'parameter') {
            return [];
        }
        const origin = derivedMethod(state, value.origin, call);
        return origin === null ? [] : [ { kind: 'origin' as const, origin } ];
    });
    return callee?.kind === 'alternatives'
        ? possibleValues(derived)
        : derived[0] ?? originValue({ kind: 'call', node: call }, []);
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
                ? originValue({ kind: 'function', node: matched }, [])
                : undefined;
        });
}

function forgetCapturedObjects(state: State, captured: ReadonlySet<Variable>): void {
    if (state.operands !== null) {
        const { identity, liveImports } = state.operands;
        liveImports.forEach(function (variable) {
            identity.forget(variable);
        });
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
            bindPattern(state, variables, declaration.id, unknownInput);
        }
    } else {
        bindPattern(state, variables, node.left, unknownInput);
    }
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
    forgetCapturedObjects(state, captured);
}

export function transfer(
    state: State,
    variables: Variables,
    captured: ReadonlySet<Variable>,
    node: Tree.Node
): void {
    const value = expressionValue(state, variables, node);
    state.expressions.store(node, value);
    recordOperand(state, variables, node);
    const result = branchResult(node);
    if (result !== undefined) {
        state.expressions.store(result, value);
    }
    match(node)
        .with({ type: NodeType.VariableDeclarator }, function (matched) {
            if (matched.init !== null) {
                bindPattern(state, variables, matched.id, {
                    value: state.expressions.get(matched.init),
                    source: matched.init
                });
            }
        })
        .with({ type: NodeType.AssignmentExpression }, function (matched) {
            bindPattern(state, variables, matched.left, {
                value,
                source: matched.operator === '=' ? matched.right : null
            });
        })
        .with({ type: NodeType.UpdateExpression }, function (matched) {
            bindPattern(state, variables, matched.argument, unknownInput);
        })
        .with({ type: NodeType.UnaryExpression }, function (matched) {
            if (matched.operator === 'delete') {
                if (state.operands !== null && matched.argument.type === NodeType.MemberExpression) {
                    forgetObject(state, state.expressions.get(matched.argument.object));
                }
                bindPattern(state, variables, matched.argument, unknownInput);
            }
        })
        .with({ type: NodeType.CallExpression }, { type: NodeType.NewExpression }, function (matched) {
            escapeArguments(state, matched, captured);
        })
        .with({ type: NodeType.MemberExpression }, function (member) {
            if (state.operands?.identity.isRead(member) === false) {
                forgetCapturedObjects(state, captured);
            }
        })
        .with({ type: NodeType.AwaitExpression }, { type: NodeType.YieldExpression }, function () {
            if (state.operands !== null) {
                forgetCapturedObjects(state, captured);
            }
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
