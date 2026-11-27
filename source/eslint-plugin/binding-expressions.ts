import { AST_NODE_TYPES as NodeType, type TSESTree as Tree } from '@typescript-eslint/utils';
import { match } from 'ts-pattern';
import type { Allocation, State, Value, Variable } from './binding-state.ts';
import type { OperandIdentity, OperandSlot } from './operand-identity.ts';

function literalKey(node: Readonly<Tree.Node>): string | undefined {
    if (node.type !== NodeType.Literal) {
        return undefined;
    }
    const { value } = node;
    return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;
}

export function propertyKey(state: State, node: Readonly<Tree.Node>, computed: boolean): string | undefined {
    if (!computed && node.type === NodeType.Identifier) {
        return node.name;
    }
    const value = state.expressions.get(node);
    return value?.kind === 'key' ? value.key : literalKey(node);
}

function ownField(operands: NonNullable<State['operands']>, allocation: Allocation, key: string): OperandSlot | null {
    return operands.keys.get(allocation)?.has(key) === true ? operands.field(allocation, key) : null;
}

export function fieldRead(state: State, receiver: Value | undefined, key: string | undefined): OperandSlot | null {
    const { operands } = state;
    return operands !== null && receiver?.kind === 'object' && key !== undefined
        ? ownField(operands, receiver.allocation, key)
        : null;
}

export function recordFields(state: State, allocation: Allocation, fields: ReadonlyMap<string, Tree.Node>): void {
    const { operands } = state;
    if (operands !== null && state.objects.has(allocation)) {
        operands.replaceFields(allocation, new Set(fields.keys()));
        fields.forEach(function (expression, key) {
            operands.identity.assign(operands.field(allocation, key), expression);
        });
    }
}

export function ownFields(state: State, node: Readonly<Tree.ObjectExpression>): ReadonlyMap<string, Tree.Node> {
    const fields = new Map<string, Tree.Node>();
    for (const property of node.properties) {
        const key = property.type === NodeType.Property
            ? propertyKey(state, property.key, property.computed)
            : undefined;
        if (property.type === NodeType.Property && key !== undefined) {
            fields.set(key, property.value);
        } else {
            fields.clear();
        }
    }
    return fields;
}

export function branchResult(node: Readonly<Tree.Node>): Tree.Node | undefined {
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

type OperandRead = {
    readonly source: OperandSlot | null;
    readonly stable: boolean;
};

function stableMemberKey(
    identity: OperandIdentity,
    member: Readonly<Tree.MemberExpression>
): boolean {
    return !member.computed || member.property.type === NodeType.Literal || identity.isRead(member.property);
}

function memberRead(state: State, member: Readonly<Tree.MemberExpression>): OperandRead {
    const receiver = state.expressions.get(member.object);
    const source = fieldRead(state, receiver, propertyKey(state, member.property, member.computed));
    const identity = state.operands?.identity;
    return {
        source,
        stable: source !== null && identity !== undefined && stableMemberKey(identity, member) &&
            identity.isRead(member.object)
    };
}

function operandRead(state: State, variables: ReadonlyMap<Tree.Node, Variable>, node: Tree.Node): OperandRead {
    const identity = state.operands?.identity;
    return match(node)
        .with({ type: NodeType.Identifier }, function (identifier) {
            const variable = variables.get(identifier);
            const stable = variable !== undefined && variable.defs.length > 0;
            if (stable) {
                identity?.ensure(variable);
            }
            return { source: stable ? variable : null, stable };
        })
        .with({ type: NodeType.MemberExpression }, function (member) {
            return memberRead(state, member);
        })
        .with(
            { type: NodeType.TSAsExpression },
            { type: NodeType.TSInstantiationExpression },
            { type: NodeType.TSNonNullExpression },
            { type: NodeType.TSSatisfiesExpression },
            { type: NodeType.TSTypeAssertion },
            { type: NodeType.ChainExpression },
            function ({ expression }) {
                return { source: expression, stable: identity?.isRead(expression) === true };
            }
        )
        .with({ type: NodeType.ConditionalExpression }, { type: NodeType.LogicalExpression }, function () {
            return { source: node, stable: false };
        })
        .with({ type: NodeType.AssignmentExpression }, function ({ operator, right }) {
            return { source: operator === '=' ? right : null, stable: false };
        })
        .otherwise(function () {
            return { source: null, stable: false };
        });
}

function isOperandExpression(node: Readonly<Tree.Node>): boolean {
    return node.type.endsWith('Expression') || node.type === NodeType.Identifier ||
        node.type === NodeType.Literal || node.type === NodeType.TemplateLiteral;
}

export function recordOperand(state: State, variables: ReadonlyMap<Tree.Node, Variable>, node: Tree.Node): void {
    if (state.operands !== null && isOperandExpression(node)) {
        const { identity } = state.operands;
        const { source, stable } = operandRead(state, variables, node);
        identity.assign(node, source);
        if (stable) {
            identity.recordRead(node);
        } else {
            identity.forgetRead(node);
        }
        const result = branchResult(node);
        if (result !== undefined) {
            identity.assign(result, node);
        }
    }
}
