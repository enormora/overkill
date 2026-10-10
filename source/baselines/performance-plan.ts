import { compareExactly } from '../compare/raw-comparison.ts';
import { snapshotJson } from '../attachments/json-snapshot.ts';
import type { WorkId } from '../engine/identity.ts';
import type { PerformanceBaselineAdapter, PerformanceBaselineValue } from './performance-adapter.ts';
import type { BaselineChange, BaselineUpdateMode, StoredPerformanceBaseline } from './performance-baseline.ts';

type PerformanceProposalPlan = {
    readonly actual: PerformanceBaselineValue;
    readonly adapter: PerformanceBaselineAdapter;
    readonly existing: StoredPerformanceBaseline | null;
    readonly maxBytes: number;
    readonly mode: BaselineUpdateMode;
    readonly profile: string;
    readonly work: WorkId;
};

function preservesBaseline(input: PerformanceProposalPlan): boolean {
    return input.mode === 'none' || input.mode === 'bootstrap' && input.existing !== null;
}

function previousExpectation(existing: StoredPerformanceBaseline | null): PerformanceBaselineValue | null {
    return existing === null ? null : existing.expected;
}

export function proposePerformanceBaseline(input: PerformanceProposalPlan): BaselineChange | null {
    if (preservesBaseline(input)) {
        return null;
    }
    const proposal = input.adapter.propose({ actual: input.actual, expected: previousExpectation(input.existing) });
    const snapshot = snapshotJson(proposal, input.maxBytes);
    if (snapshot === null) {
        throw new Error('Performance baseline proposal exceeds the configured artifact byte limit.');
    }
    if (input.existing !== null && compareExactly(input.existing.expected.value, snapshot.value)) {
        return null;
    }
    const baseline: StoredPerformanceBaseline = {
        adapter: input.adapter.id,
        expected: { calibration: input.actual.calibration, value: snapshot.value },
        profile: input.profile,
        subtype: 'performance-baseline',
        version: 1,
        work: input.work
    };
    return input.existing === null
        ? { baseline, kind: 'create' }
        : { baseline, kind: 'update', previous: input.existing };
}
