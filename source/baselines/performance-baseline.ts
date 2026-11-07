import { canonicalIdentityJson } from '../canonical-identity.ts';
import type { BenchmarkNormalizationEvidence } from '../engine/benchmark-result.ts';
import type {
    BenchmarkCalibrationResult as BenchmarkCalibrationResultDefinition
} from '../bench/host-calibration-result.ts';
import type { CaseId, WorkId } from '../engine/identity.ts';
import { findStaleBaselines } from './baseline-planning.ts';
import type {
    BaselineIdentity,
    BaselineChange as SharedBaselineChange,
    BaselineEntry as SharedBaselineEntry,
    BaselineWriteOutcome as SharedBaselineWriteOutcome,
    BaselineSubtype as SharedBaselineSubtype,
    BaselineUpdateMode as SharedBaselineUpdateMode
} from './baseline-model.ts';
import type { PerformanceBaselineValue } from './performance-adapter.ts';

export type BaselineSubtype = SharedBaselineSubtype;
export type BaselineUpdateMode = SharedBaselineUpdateMode;

export const previousNormalizedPerformanceBaselineVersion = 2;
export const normalizedPerformanceBaselineVersion = 3;

export type CalibrationReferenceChange = { readonly kind: 'remove' | 'write'; readonly path: string; };

export type PerformanceBaselineIdentity = {
    readonly adapter: string;
    readonly machineClass: string;
    readonly profile: string;
    readonly work: WorkId;
};
type PerformanceBaselineData = {
    readonly adapter: string;
    readonly expected: PerformanceBaselineValue;
    readonly profile: string;
    readonly subtype: 'performance-baseline';
    readonly work: WorkId;
};
type LegacyPerformanceBaseline = PerformanceBaselineData & { readonly version: 1; };
type NormalizedPerformanceBaseline = PerformanceBaselineData & {
    readonly version: typeof normalizedPerformanceBaselineVersion | typeof previousNormalizedPerformanceBaselineVersion;
    readonly normalization: BenchmarkNormalizationEvidence | null;
};
export type StoredPerformanceBaseline = LegacyPerformanceBaseline | NormalizedPerformanceBaseline;
export type BaselineEntry<TBaseline = StoredPerformanceBaseline> = SharedBaselineEntry<TBaseline>;
export type BaselineChange<TBaseline = StoredPerformanceBaseline> = SharedBaselineChange<TBaseline>;
export type BaselineWriteOutcome<TBaseline = StoredPerformanceBaseline> = SharedBaselineWriteOutcome<TBaseline>;

export function performanceComparisonClass(
    machineClass: string,
    normalization: BenchmarkNormalizationEvidence | null
): string {
    if (normalization === null || Object.keys(normalization.metrics).length === 0) {
        return machineClass;
    }
    const metrics = Object.fromEntries(
        Object.entries(normalization.metrics).map(function metricIdentity([ name, metric ]) {
            return [ name, { calibration: metric.actual.identity, scaling: metric.scaling } ];
        })
    );
    return `normalized:${canonicalIdentityJson(metrics)}`;
}
export function performanceBaselineIdentity(baseline: StoredPerformanceBaseline): PerformanceBaselineIdentity {
    return {
        adapter: baseline.adapter,
        machineClass: performanceComparisonClass(
            baseline.expected.calibration.machineClass,
            baseline.version === normalizedPerformanceBaselineVersion ? baseline.normalization : null
        ),
        profile: baseline.profile,
        work: baseline.work
    };
}

export type BenchmarkCalibrationResult = BenchmarkCalibrationResultDefinition;

function sharedPerformanceIdentity(baseline: StoredPerformanceBaseline): BaselineIdentity {
    const { machineClass, ...identity } = performanceBaselineIdentity(baseline);
    return { ...identity, subtype: 'performance-baseline', comparisonContext: { machineClass } };
}
export function stalePerformanceBaselines(
    existing: ReadonlyMap<string, StoredPerformanceBaseline>,
    participating: ReadonlySet<string>,
    preservedCases: readonly CaseId[]
): readonly StoredPerformanceBaseline[] {
    return findStaleBaselines(Array.from(existing.values()), {
        kind: 'complete',
        participating: Array
            .from(existing)
            .filter(function participatingEntry([ key ]) {
                return participating.has(key);
            })
            .map(function identity([ , baseline ]) {
                return sharedPerformanceIdentity(baseline);
            }),
        preservedCases
    }, sharedPerformanceIdentity);
}
