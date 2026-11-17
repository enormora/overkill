import type { WorkId, AttemptId } from './identity.ts';

import type { MetricReading, MetricProvenance } from './benchmark-metrics.ts';

export type MeasurementInvocation = {
    readonly execution: string;
    readonly work: WorkId;
    readonly attempt: AttemptId;
    readonly phase: 'measured' | 'warmup';
    readonly index: number;
};
export type MeasurementTargetIdentity = {
    readonly semantics: Readonly<Record<string, string>>;
    readonly name: string;
    readonly version: string;
    readonly scope: string;
    readonly clock: string;
    readonly instance: string;
    readonly document: string | null;
};
export type CollectorCompleteness = {
    readonly kind: 'complete';
} | {
    readonly kind: 'incomplete';
    readonly reasons: readonly string[];
};
export type CollectorResult = {
    readonly invocation: MeasurementInvocation;
    readonly target: MeasurementTargetIdentity;
    readonly completeness: CollectorCompleteness;
    readonly readings: Readonly<Record<string, MetricReading>>;
};
export type MeasurementInvocationEvidence = {
    readonly invocation: MeasurementInvocation;
    readonly target: MeasurementTargetIdentity;
    readonly collectors: readonly {
        readonly name: string;
        readonly version: string;
        readonly result: CollectorResult | null;
    }[];
    readonly status: 'complete' | 'incomplete';
    readonly errors: readonly string[];
    readonly durationMicroseconds: number | null;
    readonly lifecycleMicroseconds: number | null;
};
export type MeasurementComparisonIdentity = {
    readonly target: Pick<MeasurementTargetIdentity, 'clock' | 'name' | 'scope' | 'semantics' | 'version'>;
    readonly collectors: readonly {
        readonly name: string;
        readonly version: string;
        readonly metrics: readonly (MetricProvenance & { readonly name: string; })[];
    }[];
};
export type MeasurementEvidence = {
    readonly identity: MeasurementComparisonIdentity;
    readonly version: 1;
    readonly invocations: readonly MeasurementInvocationEvidence[];
    readonly omitted: number;
};

export type ReadingAttribution = {
    readonly invocation: MeasurementInvocation;
    readonly target: MeasurementTargetIdentity;
};
export type RawBenchmarkSample = { readonly reading: MetricReading; readonly attribution: ReadingAttribution | null; };
export const rawBenchmarkSamplesVersion = 2;
export type RawBenchmarkSamples = {
    readonly version: typeof rawBenchmarkSamplesVersion;
    readonly metrics: Readonly<Record<string, readonly RawBenchmarkSample[]>>;
};
