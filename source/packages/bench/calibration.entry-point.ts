export { calibrateBenchmarkHost, normalizeBenchmarkDuration } from '../run/benchmark-calibration.entry-point.ts';
export type { BenchmarkCalibrationResult, ComparableCalibration } from '../run/benchmark-calibration.entry-point.ts';

export { cpuCalibration } from '../../bench/cpu-calibration.ts';
export { defineCalibrationResource } from '../../bench/calibration-resource.ts';
export type {
    CalibrationResource,
    CalibrationOptions,
    CalibrationDefinition,
    CalibrationMeasureContext
} from '../../bench/calibration-definition.ts';
export type { CalibrationSnapshot, CalibrationResult } from '../../engine/benchmark-result.ts';

export { readCalibrationReferenceReport } from '../run/benchmark-calibration.entry-point.ts';
export type { CalibrationReferenceReport } from '../run/benchmark-calibration.entry-point.ts';
