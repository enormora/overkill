import type {
    AsyncMeasurementSample,
    AsyncMeasurementStrategy,
    MeasurementSample,
    MeasurementStrategy
} from './measurement-types.ts';
import type { ProcessMeasurementStrategy, ProcessSample } from './process-measurement.ts';

export type UncalibratedMeasurement = AsyncMeasurementStrategy | MeasurementStrategy | ProcessMeasurementStrategy;
type StrategySamples = {
    readonly async: AsyncMeasurementSample;
    readonly sync: MeasurementSample;
    readonly process: ProcessSample;
};
export type SampleForStrategy<Measurement extends UncalibratedMeasurement> = StrategySamples[Measurement['mode']];
