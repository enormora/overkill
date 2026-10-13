import type { MetricProvenance, MetricReading } from '../engine/benchmark-result.ts';

export type MetricDeclaration = MetricProvenance & { readonly name: string; };
export type MetricReadings = Readonly<Record<string, MetricReading>>;
export type CollectorSession = {
    readonly start: () => void;
    readonly stop: () => void;
    readonly complete: () => MetricReadings;
    readonly dispose: () => void;
};
export type AsyncCollectorSession = {
    readonly start: () => void;
    readonly stop: () => void;
    readonly complete: () => Promise<MetricReadings>;
    readonly dispose: () => Promise<void>;
};
export type MetricCollector = {
    readonly name: string;
    readonly mode: 'sync';
    readonly metrics: readonly MetricDeclaration[];
    readonly prepare: (signal: AbortSignal) => CollectorSession;
};
export type AsyncMetricCollector = {
    readonly name: string;
    readonly mode: 'async';
    readonly metrics: readonly MetricDeclaration[];
    readonly prepare: (signal: AbortSignal) => Promise<AsyncCollectorSession>;
};
export type MeasurementStrategy = {
    readonly mode: 'sync';
    readonly collectors: readonly MetricCollector[];
};
export type AsyncMeasurementStrategy = {
    readonly mode: 'async';
    readonly collectors: readonly (AsyncMetricCollector | MetricCollector)[];
};
export type Measured<Value> = {
    readonly value: Value;
    readonly metrics: MetricReadings & {
        readonly durationMicroseconds: MetricReading;
        readonly operationsPerSecond: MetricReading;
    };
};
export type MeasurementSample = {
    readonly measure: {
        (operation: () => never): never;
        (operations: number, operation: () => never): never;
        <Value>(operation: () => Promise<Value>): Promise<Measured<Value>>;
        <Value>(operation: () => Value): Measured<Value>;
        <Value>(operations: number, operation: () => Promise<Value>): Promise<Measured<Value>>;
        <Value>(operations: number, operation: () => Value): Measured<Value>;
    };
};
export type AsyncMeasurementSample = {
    readonly measure: {
        <Value>(operation: () => Promise<Value> | Value): Promise<Measured<Value>>;
        <Value>(operations: number, operation: () => Promise<Value> | Value): Promise<Measured<Value>>;
    };
};
