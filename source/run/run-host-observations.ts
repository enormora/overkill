import type { Clock } from '@enormora/clock';
import type { BenchmarkHostSnapshot } from '../bench/benchmark-host-snapshot.ts';
import type { RunProcessUsageTracker } from './run-engine-primitives.ts';
import type { runRecordVersions } from './run-record-versions.ts';

export type ProcessUsageTrackerOptions = { readonly samplingIntervalMilliseconds: number; };
export type BenchmarkHostObservationRequest = { readonly timeoutMilliseconds: number; };
export type RunHostObservations = {
    readonly collectBenchmarkHost: (
        request: BenchmarkHostObservationRequest
    ) => BenchmarkHostSnapshot | Promise<BenchmarkHostSnapshot>;
    readonly availableParallelism: number;
    readonly createProcessUsageTracker: (options: ProcessUsageTrackerOptions) => RunProcessUsageTracker;
    readonly readRunVersions: typeof runRecordVersions;
    readonly node: { readonly arch: string; readonly platform: string; readonly version: string; };
    readonly wallClock: Clock;
};
