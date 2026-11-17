import type { MeasurementComparisonIdentity } from '../engine/measurement-evidence.ts';
import { canonicalIdentityJson } from '../canonical-identity.ts';
import type { BenchmarkNormalizationEvidence, BenchmarkExecutionResult } from '../engine/benchmark-result.ts';
import type {
    BenchmarkCalibrationResult as BenchmarkCalibrationResultDefinition
} from '../bench/host-calibration-result.ts';
import type { CaseId, WorkId } from '../engine/identity.ts';
import type { BenchmarkBaseline } from './baseline-values.ts';
import { findStaleBaselines } from './baseline-planning.ts';
import type {
    BaselineIdentity,
    BaselineChange as SharedBaselineChange,
    BaselineEntry as SharedBaselineEntry,
    BaselineWriteOutcome as SharedBaselineWriteOutcome,
    BaselineSubtype as SharedBaselineSubtype,
    BaselineUpdateMode as SharedBaselineUpdateMode
} from './baseline-model.ts';

export type BaselineSubtype = SharedBaselineSubtype;
export type BaselineUpdateMode = SharedBaselineUpdateMode;

export const normalizedPerformanceBaselineVersion = 1;

export type CalibrationReferenceChange = { readonly kind: 'remove' | 'write'; readonly path: string; };

export type PerformanceBaselineIdentity = {
    readonly measurement: string | null;
    readonly adapter: string;
    readonly machineClass: string;
    readonly profile: string;
    readonly work: WorkId;
};
export type StoredPerformanceBaseline = BenchmarkBaseline;
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

export function performanceMeasurementIdentity(
    benchmark: BenchmarkExecutionResult | null
): MeasurementComparisonIdentity | null {
    return benchmark?.lifecycle?.measurement?.identity ?? null;
}
export function measurementComparisonClass(benchmark: BenchmarkExecutionResult | null): string | null {
    const identity = performanceMeasurementIdentity(benchmark);
    return identity === null ? null : canonicalIdentityJson(identity);
}
export function performanceBaselineIdentity(baseline: StoredPerformanceBaseline): PerformanceBaselineIdentity {
    return {
        measurement: baseline.measurement !== null
            ? canonicalIdentityJson(baseline.measurement)
            : null,
        adapter: baseline.adapter,
        machineClass: performanceComparisonClass(
            baseline.expected.calibration.machineClass,
            baseline.normalization
        ),
        profile: baseline.profile,
        work: baseline.work
    };
}

export type BenchmarkCalibrationResult = BenchmarkCalibrationResultDefinition;

function sharedPerformanceIdentity(baseline: StoredPerformanceBaseline): BaselineIdentity {
    const { machineClass, measurement, ...identity } = performanceBaselineIdentity(baseline);
    return {
        ...identity,
        subtype: 'performance-baseline',
        comparisonContext: measurement === null ? { machineClass } : { machineClass, measurement }
    };
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
