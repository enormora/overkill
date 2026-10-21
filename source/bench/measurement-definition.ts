import type { BenchmarkDefinitionSummary } from '../engine/benchmark-result.ts';
import type {
    AsyncMeasurementSample,
    AsyncMeasurementStrategy,
    MeasurementSample,
    MeasurementStrategy
} from './measurement-types.ts';
import { processMeasurement, type ProcessMeasurementStrategy, type ProcessSample } from './process-measurement.ts';

type MeasurementStrategies = {
    readonly async: AsyncMeasurementStrategy;
    readonly sync: MeasurementStrategy;
    readonly process: ProcessMeasurementStrategy;
};
export type UncalibratedMeasurement = MeasurementStrategies[keyof MeasurementStrategies];
type StrategySamples = {
    readonly async: AsyncMeasurementSample;
    readonly sync: MeasurementSample;
    readonly process: ProcessSample;
};
export type SampleForStrategy<Measurement extends UncalibratedMeasurement> = StrategySamples[Measurement['mode']];

export function summarizeMeasurement(
    measurement: UncalibratedMeasurement
): BenchmarkDefinitionSummary['measurement'] {
    if (measurement.mode === 'process') {
        return processMeasurement(measurement);
    }
    return Object.freeze({
        mode: measurement.mode,
        collectors: Object.freeze(measurement.collectors.map(function collectorDefinition(collector) {
            return Object.freeze({
                name: collector.name,
                metrics: Object.freeze(collector.metrics.map(function declaration(metric) {
                    return Object.freeze({ ...metric });
                }))
            });
        }))
    });
}
