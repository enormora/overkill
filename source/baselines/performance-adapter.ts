import type { JsonValue, ReadonlyDeep } from 'type-fest';
import type { WorkId } from '../engine/identity.ts';
import type { RunArtifact } from '../engine/run-result.ts';
import type {
    ComparableCalibration as ComparableCalibrationDefinition
} from '../packages/run/benchmark-calibration.entry-point.ts';

export type BaselineJson = ReadonlyDeep<JsonValue>;
export type PerformanceBaselineValue = {
    readonly calibration: ComparableCalibration;
    readonly value: BaselineJson;
};
type MissingObservation = { readonly kind: 'missing'; readonly reason: string; };
type InapplicableObservation = { readonly kind: 'not-applicable'; };
type ObservedValue = { readonly kind: 'observed'; readonly value: BaselineJson; };
export type PerformanceObservation = InapplicableObservation | MissingObservation | ObservedValue;
export type BaselineDiagnostic = {
    readonly actual: BaselineJson;
    readonly expected: BaselineJson;
    readonly summary: string;
};
type MatchingPerformance = { readonly kind: 'match'; };
type MismatchingPerformance = {
    readonly diagnostics: readonly [BaselineDiagnostic, ...(readonly BaselineDiagnostic[])];
    readonly kind: 'mismatch';
};
export type PerformanceComparison = MatchingPerformance | MismatchingPerformance;
export type PerformanceObservationInput = {
    readonly artifacts: readonly RunArtifact[];
    readonly calibration: ComparableCalibration;
    readonly work: WorkId;
};
export type PerformanceProposalInput = {
    readonly actual: PerformanceBaselineValue;
    readonly expected: PerformanceBaselineValue | null;
};
export type PerformanceComparisonInput = {
    readonly actual: PerformanceBaselineValue;
    readonly expected: PerformanceBaselineValue;
};
export type PerformanceBaselineAdapter = {
    readonly id: string;
    readonly observe: (input: PerformanceObservationInput) => PerformanceObservation;
    readonly propose: (input: PerformanceProposalInput) => BaselineJson;
    readonly compare: (input: PerformanceComparisonInput) => PerformanceComparison;
};
export type BenchmarkBaselinePolicy = {
    readonly adapters: readonly PerformanceBaselineAdapter[];
    readonly directory: string;
};

export type ComparableCalibration = ComparableCalibrationDefinition;
