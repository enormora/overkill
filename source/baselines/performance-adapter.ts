import type { WorkId } from '../engine/identity.ts';
import type { RunArtifact } from '../engine/run-result.ts';
import type {
    ComparableCalibration as ComparableCalibrationDefinition
} from '../bench/host-calibration-result.ts';
import type * as Values from './baseline-values.ts';
import type { BaselineJson as SharedBaselineJson, BaselineObservation, BaselineComparison } from './baseline-model.ts';

export type BaselineJson = SharedBaselineJson;

export type PerformanceBaselineValue = Values.PerformanceBaselineValue;
export type PerformanceObservation = BaselineObservation<BaselineJson>;
export type BaselineDiagnostic = Values.BaselineDiagnostic;
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
export type PerformanceMetricReference = Values.PerformanceMetricReference;
export type PerformanceMetricScale = Values.PerformanceMetricScale;
export type PerformanceMetricComparison = Values.PerformanceMetricComparison;
export type ChartedPerformanceBaselineAdapter = PerformanceBaselineOperations & {
    readonly describeMetrics: (input: PerformanceProposalInput) => readonly PerformanceMetricComparison[];
};
export type PerformanceBaselineAdapter = ChartedPerformanceBaselineAdapter | PerformanceBaselineOperations;

export type ComparableCalibration = ComparableCalibrationDefinition;
