export type BenchmarkTimelinePolicy = { readonly maximumEvents: number; };
export type BenchmarkTimelineEvent = {
    readonly name: string;
    readonly source: 'authored' | 'harness' | 'process' | 'runtime';
    readonly phase: 'measured' | 'warmup';
    readonly sample: number;
    readonly clockDomain: string;
    readonly startMicroseconds: number;
    readonly durationMicroseconds: number | null;
    readonly outcome: 'complete' | 'failed' | 'incomplete';
};
export type BenchmarkTimelineEvidence = {
    readonly version: 1;
    readonly events: number;
    readonly omitted: number;
    readonly status: 'omitted' | 'pending' | 'recorded';
    readonly reference: string | null;
    readonly reason: string | null;
};
export type BenchmarkTimelineReport = {
    readonly version: 1;
    readonly events: readonly BenchmarkTimelineEvent[];
    readonly omitted: number;
};
export type BenchmarkTimeline = {
    readonly mark: (name: string) => void;
    readonly span: <Value>(name: string, operation: () => Value) => Value;
};
