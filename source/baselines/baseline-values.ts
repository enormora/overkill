import type { MeasurementComparisonIdentity } from '../engine/measurement-evidence.ts';
import type { WorkId } from '../engine/identity.ts';
import type { BenchmarkNormalizationEvidence } from '../engine/benchmark-result.ts';
import type { ComparableCalibration } from '../bench/host-calibration-result.ts';
import type {
    BaselineJson,
    BaselineObservation,
    BaselineComparison,
    BaselineChange,
    BaselineWriteOutcome
} from './baseline-model.ts';

export type PerformanceBaselineValue = {
    readonly calibration: ComparableCalibration;
    readonly value: BaselineJson;
};
export type PerformanceObservation = BaselineObservation<BaselineJson>;
export type BaselineDiagnostic = {
    readonly actual: BaselineJson;
    readonly expected: BaselineJson;
    readonly summary: string;
};
export type PerformanceComparison = BaselineComparison<BaselineDiagnostic>;
type MissingMetricReference = { readonly kind: 'missing'; };
type PointMetricReference = { readonly kind: 'value'; readonly value: number; };
type RangeMetricReference = {
    readonly kind: 'range';
    readonly minimum: number | null;
    readonly maximum: number | null;
};
export type PerformanceMetricReference = MissingMetricReference | PointMetricReference | RangeMetricReference;
type RawMetricScale = { readonly kind: 'raw'; };
type NormalizedMetricScale = { readonly kind: 'normalized'; readonly description: string; };
export type PerformanceMetricScale = NormalizedMetricScale | RawMetricScale;
export type PerformanceMetricComparison = {
    readonly name: string;
    readonly unit: string;
    readonly scale: PerformanceMetricScale;
    readonly actual: number | null;
    readonly expected: PerformanceMetricReference;
};
export type PerformanceProposalInput = {
    readonly actual: PerformanceBaselineValue;
    readonly expected: PerformanceBaselineValue | null;
};
type ObservedPerformance = PerformanceProposalInput & {
    readonly kind: 'observed';
    readonly comparison: PerformanceComparison | null;
};
type InapplicablePerformance = { readonly kind: 'not-applicable'; };
type UnevaluatedPerformance = { readonly kind: 'not-evaluated'; readonly reason: string; };
type ErroredPerformance = { readonly kind: 'error'; readonly reason: string; };
type PerformanceObservationStates = {
    readonly error: ErroredPerformance;
    readonly inapplicable: InapplicablePerformance;
    readonly observed: ObservedPerformance;
    readonly unevaluated: UnevaluatedPerformance;
};
export type PerformanceObservationEvidence = PerformanceObservationStates[keyof PerformanceObservationStates];
type AvailablePresentation = { readonly kind: 'available'; readonly metrics: readonly PerformanceMetricComparison[]; };
type UnavailablePresentation = { readonly kind: 'unavailable'; readonly reason: string; };
type ErroredPresentation = { readonly kind: 'error'; readonly reason: string; };
export type PerformancePresentation = AvailablePresentation | ErroredPresentation | UnavailablePresentation;
export type PerformanceBaselineEvidence = {
    readonly adapter: string;
    readonly work: WorkId;
    readonly observation: PerformanceObservationEvidence;
    readonly presentation: PerformancePresentation;
};
export type SnapshotBaseline = {
    readonly version: 1;
    readonly adapter: string;
    readonly profile: string;
    readonly subtype: 'content-snapshot' | 'terminal-snapshot' | 'visual-snapshot';
    readonly work: WorkId;
    readonly comparisonContext: Readonly<Record<string, string>>;
    readonly payload: {
        readonly kind: 'binary';
        readonly base64: string;
    } | {
        readonly kind: 'text';
        readonly text: string;
    };
};
export type BenchmarkBaseline = {
    readonly measurement: MeasurementComparisonIdentity | null;
    readonly version: 1;
    readonly adapter: string;
    readonly profile: string;
    readonly subtype: 'performance-baseline';
    readonly work: WorkId;
    readonly expected: PerformanceBaselineValue;
    readonly normalization: BenchmarkNormalizationEvidence | null;
};
export type SnapshotBaselineReport = {
    readonly changes: readonly BaselineChange<SnapshotBaseline>[];
    readonly warnings: readonly string[];
    readonly writeOutcome: BaselineWriteOutcome<SnapshotBaseline>;
};
export type BenchmarkBaselineReport = {
    readonly changes: readonly BaselineChange<BenchmarkBaseline>[];
    readonly comparisons: readonly PerformanceBaselineEvidence[];
    readonly calibration: ComparableCalibration;
    readonly writeOutcome: BaselineWriteOutcome<BenchmarkBaseline>;
};

export type CalibrationReferenceReport = {
    readonly changes: readonly { readonly kind: 'remove' | 'write'; readonly path: string; }[];
    readonly completed: readonly string[];
    readonly outcome: 'blocked' | 'failed' | 'read-only' | 'written';
};
