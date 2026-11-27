import type { TSESLint, TSESTree as Tree } from '@typescript-eslint/utils';

type Node = Readonly<Tree.Node>;
export type OperandSlot = Node | Readonly<TSESLint.Scope.Variable> | symbol;

type OperandPartition = {
    readonly classes: ReadonlyMap<OperandSlot, symbol>;
    readonly reads: ReadonlySet<Node>;
};

export type OperandIdentity = OperandPartition & {
    readonly copy: () => OperandIdentity;
    readonly retain: (slots: ReadonlySet<OperandSlot>) => OperandIdentity;
    readonly ensure: (slot: OperandSlot) => void;
    readonly assign: (slot: OperandSlot, source: OperandSlot | null) => void;
    readonly forget: (slot: OperandSlot) => void;
    readonly has: (slot: OperandSlot) => boolean;
    readonly same: (left: OperandSlot, right: OperandSlot) => boolean;
    readonly recordRead: (node: Node) => void;
    readonly forgetRead: (node: Node) => void;
    readonly isRead: (node: Node) => boolean;
    readonly join: (other: OperandPartition) => OperandIdentity;
    readonly sameFacts: (other: OperandPartition) => boolean;
};

function joinPartitions(left: OperandPartition, right: OperandPartition): OperandPartition {
    const classes = new Map<OperandSlot, symbol>();
    const reads = new Set<Node>();
    const intersections = new Map<symbol, Map<symbol, symbol>>();
    left.classes.forEach(function (identity, slot) {
        const counterpart = right.classes.get(slot);
        if (counterpart !== undefined) {
            const group = intersections.get(identity) ?? new Map<symbol, symbol>();
            const joined = group.get(counterpart) ?? Symbol();
            classes.set(slot, joined);
            group.set(counterpart, joined);
            intersections.set(identity, group);
        }
    });
    for (const node of left.reads) {
        if (right.reads.has(node)) {
            reads.add(node);
        }
    }
    return { classes, reads };
}

function classCount(partition: OperandPartition): number {
    const classes = new Set(partition.classes.values());
    return classes.size;
}

function samePartitions(left: OperandPartition, right: OperandPartition): boolean {
    const common = joinPartitions(left, right);
    const count = classCount(left);
    return common.classes.size === left.classes.size && common.classes.size === right.classes.size &&
        common.reads.size === left.reads.size && common.reads.size === right.reads.size &&
        classCount(common) === count && classCount(right) === count;
}

function operandIdentity(partition: OperandPartition): OperandIdentity {
    const classes = new Map(partition.classes);
    const reads = new Set(partition.reads);
    const facts = { classes, reads };
    return {
        ...facts,
        copy() {
            return operandIdentity(facts);
        },
        retain(slots) {
            const retained = new Map<OperandSlot, symbol>();
            classes.forEach(function (identity, slot) {
                if (slots.has(slot)) {
                    retained.set(slot, identity);
                }
            });
            return operandIdentity({ classes: retained, reads: new Set() });
        },
        ensure(slot) {
            if (!classes.has(slot)) {
                classes.set(slot, Symbol());
            }
        },
        assign(slot, source) {
            classes.set(slot, (source === null ? undefined : classes.get(source)) ?? Symbol());
        },
        forget(slot) {
            classes.delete(slot);
        },
        has(slot) {
            return classes.has(slot);
        },
        same(left, right) {
            const identity = classes.get(left);
            return identity !== undefined && identity === classes.get(right);
        },
        recordRead(node) {
            reads.add(node);
        },
        forgetRead(node) {
            reads.delete(node);
        },
        isRead(node) {
            return reads.has(node);
        },
        join(other) {
            return operandIdentity(joinPartitions(facts, other));
        },
        sameFacts(other) {
            return samePartitions(facts, other);
        }
    };
}

export function createOperandIdentity(): OperandIdentity {
    return operandIdentity({ classes: new Map(), reads: new Set() });
}
