import type {
    MeasurementInvocation,
    MeasurementTargetIdentity,
    CollectorResult
} from '../engine/measurement-evidence.ts';

import type { MetricProvenance, MetricReading } from '../engine/benchmark-metrics.ts';

export type MetricDeclaration = MetricProvenance & { readonly name: string; };
export type MetricReadings = Readonly<Record<string, MetricReading>>;
export type CollectorContext = {
    readonly invocation: MeasurementInvocation;
    readonly target: MeasurementTargetIdentity;
    readonly signal: AbortSignal;
};
export type CollectorPreparationContext = CollectorContext & {
    readonly cleanup: { readonly defer: (release: (signal: AbortSignal) => void) => void; };
};
export type AsyncCollectorPreparationContext = CollectorContext & {
    readonly cleanup: { readonly defer: (release: (signal: AbortSignal) => Promise<void> | void) => void; };
};
export type CollectorFinalizationContext = CollectorContext & {
    readonly started: boolean;
    readonly outcome: { readonly kind: 'failure'; readonly error: unknown; } | { readonly kind: 'success'; };
    readonly readings: (readings: MetricReadings) => CollectorResult;
};
export type CollectorSession = {
    readonly start: (context: CollectorContext) => void;
    readonly stop: (context: CollectorFinalizationContext) => void;
    readonly finalize: (context: CollectorFinalizationContext) => CollectorResult;
};
export type AsyncCollectorSession = {
    readonly start: (context: CollectorContext) => Promise<void> | void;
    readonly stop: (context: CollectorFinalizationContext) => Promise<void> | void;
    readonly finalize: (context: CollectorFinalizationContext) => CollectorResult | Promise<CollectorResult>;
};
export type MetricCollector = {
    readonly version: string;
    readonly name: string;
    readonly mode: 'sync';
    readonly metrics: readonly MetricDeclaration[];
    readonly prepare: (context: CollectorPreparationContext) => CollectorSession;
};
export type AsyncMetricCollector = {
    readonly version: string;
    readonly name: string;
    readonly mode: 'async';
    readonly metrics: readonly MetricDeclaration[];
    readonly prepare: (context: AsyncCollectorPreparationContext) => Promise<AsyncCollectorSession>;
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
