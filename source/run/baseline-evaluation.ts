import type { FailedCheck } from '../assertion-protocol/assertion-node-shape.ts';
import { createDefaultWorkId } from '../engine/identity.ts';
import { baselineIdentityKey, planBaselineChange } from '../baselines/baseline-planning.ts';
import type { BaselineIdentity, BaselineUpdateMode } from '../baselines/baseline-model.ts';
import type { OrdinaryBaselineAdapter, OrdinaryBaselineEvaluation } from '../baselines/ordinary-baseline-adapter.ts';
import { baselineFailedCheck, type BaselineCaseEnd } from './baseline-outcomes.ts';
import {
    persistBaselinePayload,
    restoreBaselinePayload,
    type OrdinaryBaselineChange,
    type StoredOrdinaryBaseline
} from './baseline-record.ts';

type EvaluationInput = {
    readonly adapter: OrdinaryBaselineAdapter;
    readonly event: BaselineCaseEnd;
    readonly profile: string;
    readonly mode: BaselineUpdateMode;
    readonly existing: ReadonlyMap<string, StoredOrdinaryBaseline>;
};
type ObservedBaseline = Extract<OrdinaryBaselineEvaluation, { readonly kind: 'observed'; }>;
export type OrdinaryAdapterEvaluation = {
    readonly kind: 'evaluated';
    readonly identity: BaselineIdentity;
    readonly change: OrdinaryBaselineChange | null;
    readonly checks: readonly FailedCheck[];
} | { readonly kind: 'not-applicable'; };
function proposalChange(
    input: EvaluationInput,
    identity: BaselineIdentity,
    observation: ObservedBaseline,
    previous: StoredOrdinaryBaseline | null
): OrdinaryBaselineChange | null {
    if (observation.proposal === null) {
        return null;
    }
    const baseline: StoredOrdinaryBaseline = {
        ...identity,
        subtype: input.adapter.subtype,
        version: 1,
        payload: persistBaselinePayload(observation.proposal)
    };
    return planBaselineChange({
        mode: input.mode,
        existing: previous,
        propose() {
            return baseline;
        },
        equals(left, right) {
            return JSON.stringify(left.payload) === JSON.stringify(right.payload);
        }
    });
}
function comparisonChecks(
    input: EvaluationInput,
    observation: ObservedBaseline,
    previous: StoredOrdinaryBaseline | null
): readonly FailedCheck[] {
    if (previous === null && input.mode === 'none') {
        return [
            baselineFailedCheck(input.event, `${input.adapter.id}:missing`, {
                actual: null,
                expected: null,
                summary: `Missing baseline for adapter "${input.adapter.id}".`
            })
        ];
    }
    if (observation.comparison?.kind !== 'mismatch') {
        return [];
    }
    if (observation.comparison.diagnostics.length === 0) {
        throw new Error('Baseline mismatch requires diagnostics.');
    }
    return observation.comparison.diagnostics.map(function diagnostic(check, index) {
        return baselineFailedCheck(input.event, `${input.adapter.id}:${index.toString()}`, check);
    });
}
export async function evaluateBaselineAdapter(input: EvaluationInput): Promise<OrdinaryAdapterEvaluation> {
    const work = input.event.workId ?? createDefaultWorkId(input.event.case);
    const identity: BaselineIdentity = {
        adapter: input.adapter.id,
        subtype: input.adapter.subtype,
        profile: input.profile,
        comparisonContext: input.adapter.comparisonContext,
        work
    };
    const previous = input.existing.get(baselineIdentityKey(identity)) ?? null;
    const observation = await input.adapter.evaluate({
        artifacts: input.event.artifacts,
        work,
        mode: input.mode,
        existing: previous === null ? null : restoreBaselinePayload(previous.payload)
    });
    if (observation.kind === 'not-applicable') {
        return observation;
    }
    if (observation.kind === 'missing') {
        throw new Error(observation.reason);
    }
    return {
        kind: 'evaluated',
        identity,
        change: proposalChange(input, identity, observation, previous),
        checks: comparisonChecks(input, observation, previous)
    };
}
