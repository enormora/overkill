import type { TSESTree as Tree } from '@typescript-eslint/utils';

export type OperandSlot = object;

export class OperandIdentity {
    private readonly classes = new Map<OperandSlot, object>();
    private readonly reads = new Set<Readonly<Tree.Node>>();

    copy(): OperandIdentity {
        const result = new OperandIdentity();
        this.classes.forEach((identity, slot) => result.classes.set(slot, identity));
        this.reads.forEach(node => result.reads.add(node));
        return result;
    }

    retain(slots: ReadonlySet<OperandSlot>): OperandIdentity {
        const result = new OperandIdentity();
        this.classes.forEach(function (identity, slot) {
            if (slots.has(slot)) {
                result.classes.set(slot, identity);
            }
        });
        return result;
    }

    ensure(slot: OperandSlot): void {
        if (!this.classes.has(slot)) {
            this.assign(slot, null);
        }
    }

    assign(slot: OperandSlot, source: OperandSlot | null): void {
        this.classes.set(slot, (source === null ? undefined : this.classes.get(source)) ?? {});
    }

    forget(slot: OperandSlot): void {
        this.classes.delete(slot);
    }

    has(slot: OperandSlot): boolean {
        return this.classes.has(slot);
    }

    same(left: OperandSlot, right: OperandSlot): boolean {
        const identity = this.classes.get(left);
        return identity !== undefined && identity === this.classes.get(right);
    }

    recordRead(node: Readonly<Tree.Node>, stable: boolean): void {
        if (stable) {
            this.reads.add(node);
        } else {
            this.reads.delete(node);
        }
    }

    isRead(node: Readonly<Tree.Node>): boolean {
        return this.reads.has(node);
    }

    join(other: OperandIdentity): OperandIdentity {
        const result = new OperandIdentity();
        const intersections = new Map<object, Map<object, OperandSlot>>();
        this.classes.forEach(function (identity, slot) {
            const counterpart = other.classes.get(slot);
            if (counterpart !== undefined) {
                const group = intersections.get(identity) ?? new Map<object, OperandSlot>();
                result.assign(slot, group.get(counterpart) ?? null);
                group.set(counterpart, slot);
                intersections.set(identity, group);
            }
        });
        this.reads.forEach(function (node) {
            result.recordRead(node, other.isRead(node));
        });
        return result;
    }

    sameFacts(other: OperandIdentity): boolean {
        return this.classes.size === other.classes.size && this.reads.size === other.reads.size &&
            Array.from(this.reads).every(node => other.isRead(node)) && this.sameClasses(other);
    }

    private sameClasses(other: OperandIdentity): boolean {
        const common = this.join(other);
        const classCount = new Set(this.classes.values()).size;
        return common.classes.size === this.classes.size &&
            new Set(common.classes.values()).size === classCount &&
            new Set(other.classes.values()).size === classCount;
    }
}
