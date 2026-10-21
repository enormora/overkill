import type { MetricReading } from '../engine/benchmark-result.ts';
import type { MetricReadings } from './measurement-types.ts';
import type { ProcessObservation } from './process-observation.ts';

export type ModuleMeasurementStrategy = { readonly mode: 'module'; };
export type ModuleImportRequest = {
    readonly url: URL;
    readonly cwd: string;
    readonly env: Readonly<Record<string, string>> | null;
    readonly nodeArguments: readonly string[];
};
export type MeasuredModuleImport = {
    readonly value: {
        readonly url: string;
        readonly nodeVersion: string;
        readonly nodeArguments: readonly string[];
        readonly output: ProcessObservation['output'];
    };
    readonly metrics: MetricReadings & {
        readonly durationMicroseconds: MetricReading;
        readonly operationsPerSecond: MetricReading;
        readonly processStartupMilliseconds: MetricReading;
        readonly outputBytes: MetricReading;
    };
};
export type ModuleSample = {
    readonly importModule: (request: ModuleImportRequest) => Promise<MeasuredModuleImport>;
};
export type ModuleImportObservation = {
    readonly url: string;
    readonly nodeVersion: string;
    readonly nodeArguments: readonly string[];
    readonly durationMicroseconds: number;
    readonly processStartupMilliseconds: number;
    readonly failure: string | null;
};

export function moduleMeasurement(): ModuleMeasurementStrategy {
    return Object.freeze({ mode: 'module' });
}
