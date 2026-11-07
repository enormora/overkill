import type { WorkId } from '../engine/identity.ts';
import type { RunArtifact } from '../engine/run-result.ts';
import type {
    ComparableCalibration as ComparableCalibrationDefinition
} from '../bench/host-calibration-result.ts';
import type { BaselineJson as SharedBaselineJson, BaselineObservation, BaselineComparison } from './baseline-model.ts';

export type BaselineJson = SharedBaselineJson;

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
export type PerformanceBaselineOperations = {
    readonly id: string;
    readonly observe: (input: PerformanceObservationInput) => PerformanceObservation;
    readonly propose: (input: PerformanceProposalInput) => BaselineJson;
    readonly compare: (input: PerformanceComparisonInput) => PerformanceComparison;
};
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
export type ChartedPerformanceBaselineAdapter = PerformanceBaselineOperations & {
    readonly describeMetrics: (input: PerformanceProposalInput) => readonly PerformanceMetricComparison[];
};
export type PerformanceBaselineAdapter = ChartedPerformanceBaselineAdapter | PerformanceBaselineOperations;

export type ComparableCalibration = ComparableCalibrationDefinition;
