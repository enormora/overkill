import { workIdentityProjection } from '../engine/identity.ts';
import { canonicalIdentityJson } from '../canonical-identity.ts';
import type { BaselineChange, BaselineIdentity, BaselineInventory, BaselineUpdateMode } from './baseline-model.ts';

export function baselineIdentityKey(identity: BaselineIdentity): string {
    return canonicalIdentityJson({ ...identity, work: workIdentityProjection(identity.work) });
}

type BaselineProposal<TBaseline> = {
    readonly mode: BaselineUpdateMode;
    readonly existing: TBaseline | null;
    readonly propose: () => TBaseline;
    readonly equals: (previous: TBaseline, proposed: TBaseline) => boolean;
};
export function planBaselineChange<TBaseline>(input: BaselineProposal<TBaseline>): BaselineChange<TBaseline> | null {
    if (input.mode === 'none' || input.mode === 'bootstrap' && input.existing !== null) {
        return null;
    }
    const baseline = input.propose();
    if (input.existing === null) {
        return { baseline, kind: 'create' };
    }
    return input.equals(input.existing, baseline)
        ? null
        : { baseline, kind: 'update', previous: input.existing };
}

export function findStaleBaselines<TBaseline>(
    scopedBaselines: readonly TBaseline[],
    inventory: BaselineInventory,
    identify: (baseline: TBaseline) => BaselineIdentity
): readonly TBaseline[] {
    if (inventory.kind === 'incomplete') {
        return [];
    }
    const participating = new Set(inventory.participating.map(baselineIdentityKey));
    const preserved = new Set(inventory.preservedCases.map(canonicalIdentityJson));
    return scopedBaselines.filter(function staleBaseline(baseline) {
        const identity = identify(baseline);
        return !participating.has(baselineIdentityKey(identity)) &&
            !preserved.has(canonicalIdentityJson(identity.work.case));
    });
}
