import type {
    BenchmarkNormalizationEvidence,
    CalibrationIdentity,
    CalibrationSnapshot,
    NormalizationRuleSummary
} from '../engine/benchmark-result.ts';
import { canonicalIdentityJson } from '../canonical-identity.ts';
import { compareExactly } from '../compare/raw-comparison.ts';
import { snapshotJson } from '../attachments/json-snapshot.ts';
import type { WorkId } from '../engine/identity.ts';
import { planBaselineChange } from './baseline-planning.ts';
import type { PerformanceBaselineAdapter, PerformanceBaselineValue } from './performance-adapter.ts';
import {
    normalizedPerformanceBaselineVersion,
    type BaselineChange,
    type BaselineUpdateMode,
    type StoredPerformanceBaseline
} from './performance-baseline.ts';

type PerformanceProposalPlan = {
    readonly normalization: BenchmarkNormalizationEvidence | null;
    readonly actual: PerformanceBaselineValue;
    readonly adapter: PerformanceBaselineAdapter;
    readonly existing: StoredPerformanceBaseline | null;
    readonly maxBytes: number;
    readonly mode: BaselineUpdateMode;
    readonly profile: string;
    readonly work: WorkId;
};

function previousExpectation(existing: StoredPerformanceBaseline | null): PerformanceBaselineValue | null {
    return existing === null ? null : existing.expected;
}

type NormalizationBudgetBasis = {
    readonly calibration: CalibrationIdentity;
    readonly scaling: NormalizationRuleSummary['scaling'];
    readonly budgetReference: CalibrationSnapshot;
};
function normalizationBudgetBasis(
    evidence: BenchmarkNormalizationEvidence | null
): Readonly<Record<string, NormalizationBudgetBasis>> | null {
    if (evidence === null) {
        return null;
    }
    return Object.fromEntries(
        Object.entries(evidence.metrics).map(function metricBasis([ name, metric ]) {
            return [ name, {
                calibration: metric.actual.identity,
                scaling: metric.scaling,
                budgetReference: metric.budgetReference
            } ];
        })
    );
}
function unchangedExpectation(input: PerformanceProposalPlan, value: PerformanceBaselineValue['value']): boolean {
    const { existing } = input;
    if (existing === null) {
        return false;
    }
    const normalization = existing.version === normalizedPerformanceBaselineVersion ? existing.normalization : null;
    const storedBasis = canonicalIdentityJson(normalizationBudgetBasis(normalization));
    const currentBasis = canonicalIdentityJson(normalizationBudgetBasis(input.normalization));
    return compareExactly(existing.expected.value, value) && storedBasis === currentBasis;
}
function proposedPerformanceBaseline(input: PerformanceProposalPlan): StoredPerformanceBaseline {
    const proposal = input.adapter.propose({ actual: input.actual, expected: previousExpectation(input.existing) });
    const snapshot = snapshotJson(proposal, input.maxBytes);
    if (snapshot === null) {
        throw new Error('Performance baseline proposal exceeds the configured artifact byte limit.');
    }
    const baseline: StoredPerformanceBaseline = {
        adapter: input.adapter.id,
        expected: { calibration: input.actual.calibration, value: snapshot.value },
        profile: input.profile,
        subtype: 'performance-baseline',
        ...input.normalization === null
            ? { version: 1 as const }
            : { version: normalizedPerformanceBaselineVersion, normalization: input.normalization },
        work: input.work
    };
    return baseline;
}
export function proposePerformanceBaseline(input: PerformanceProposalPlan): BaselineChange | null {
    return planBaselineChange({
        mode: input.mode,
        existing: input.existing,
        propose() {
            return proposedPerformanceBaseline(input);
        },
        equals(previous, proposed) {
            return unchangedExpectation({ ...input, existing: previous }, proposed.expected.value);
        }
    });
}
