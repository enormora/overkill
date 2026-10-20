import { canonicalIdentityJson } from '../canonical-identity.ts';
import type { BenchmarkNormalizationEvidence } from '../engine/benchmark-result.ts';
import type {
    BenchmarkCalibrationResult as BenchmarkCalibrationResultDefinition
} from '../bench/host-calibration-result.ts';
import type { WorkId } from '../engine/identity.ts';
import type { PerformanceBaselineValue } from './performance-adapter.ts';

export const previousNormalizedPerformanceBaselineVersion = 2;
export const normalizedPerformanceBaselineVersion = 3;

export type CalibrationReferenceChange = { readonly kind: 'remove' | 'write'; readonly path: string; };

export type BaselineSubtype = 'content-snapshot' | 'performance-baseline' | 'terminal-snapshot' | 'visual-snapshot';
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
export type BaselineEntry = {
    readonly baseline: StoredPerformanceBaseline;
    readonly path: string;
};
type CreatedBaseline = { readonly baseline: StoredPerformanceBaseline; readonly kind: 'create'; };
type RemovedBaseline = { readonly baseline: StoredPerformanceBaseline; readonly kind: 'remove'; };
type UpdatedBaseline = {
    readonly baseline: StoredPerformanceBaseline;
    readonly kind: 'update';
    readonly previous: StoredPerformanceBaseline;
};
export type BaselineChange = CreatedBaseline | RemovedBaseline | UpdatedBaseline;
type WrittenBaselines = { readonly changes: readonly BaselineChange[]; readonly kind: 'written'; };
type BlockedBaselineWrites = { readonly kind: 'blocked'; };
type FailedBaselineWrites = { readonly kind: 'failed'; readonly writtenChanges: readonly BaselineChange[]; };
type ReadOnlyBaselines = { readonly kind: 'read-only'; };
export type BaselineWriteOutcome = BlockedBaselineWrites | FailedBaselineWrites | ReadOnlyBaselines | WrittenBaselines;
export type BaselineUpdateMode = 'apply' | 'bootstrap' | 'diff' | 'none' | 'update';

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
