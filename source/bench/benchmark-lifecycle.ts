import { createStoredValue } from '../stored-value.ts';
import {
    benchmarkLifecycleVersion,
    type BenchmarkCooldownResult,
    type BenchmarkLifecycleResult
} from '../engine/benchmark-result.ts';
import { createBenchmarkGarbageCollection, type BenchmarkGarbageCollection } from './benchmark-garbage-collection.ts';
import type { SamplingSessionInput } from './benchmark-sampling-types.ts';
import { commitObservation, createObservationSet, summarizeObservations } from './benchmark-observation-set.ts';
import { recordObservationSamples } from './benchmark-sampling-evidence.ts';
import { createRuntimeCooldownDependencies, settleBenchmarkRuntime } from './benchmark-runtime-cooldown.ts';

export type BenchmarkLifecycle = {
    readonly garbageCollection: BenchmarkGarbageCollection;
    readonly warmupSamples: () => number;
    readonly observeWarmup: (returned: unknown) => void;
    readonly recordCleanup: (result: BenchmarkLifecycleResult['cleanup']) => void;
    readonly settle: () => Promise<void>;
    readonly retainWarmup: () => Promise<void>;
    readonly snapshot: () => BenchmarkLifecycleResult;
};

export function createBenchmarkLifecycle(input: SamplingSessionInput): BenchmarkLifecycle {
    const observations = createObservationSet([
        ...input.budgets.map(function metricName(budget) {
            return budget.metric;
        }),
        ...input.diagnostics
    ]);
    const garbageCollection = createBenchmarkGarbageCollection(input);
    let samples = 0;
    let retained = false;
    let rawSamples: BenchmarkLifecycleResult['warmup']['rawSamples'] = {
        status: 'omitted',
        reference: null,
        reason: 'Warmup observations have not been persisted.'
    };
    const cleanup = { callbacks: 0, failures: 0 };
    const cooldown = createStoredValue<BenchmarkCooldownResult>(
        input.lifecycle.cooldown.mode === 'off'
            ? { mode: 'off' }
            : {
                mode: 'runtime',
                strategy: 'event-loop-utilization-v1',
                completed: 0,
                windows: 0,
                durationMicroseconds: 0,
                lastUtilization: null,
                outcome: 'pending'
            }
    );
    return {
        garbageCollection,
        warmupSamples() {
            return samples;
        },
        observeWarmup(returned) {
            commitObservation(returned, observations);
            samples += 1;
        },
        recordCleanup(result) {
            cleanup.callbacks += result.callbacks;
            cleanup.failures += result.failures;
        },
        async settle() {
            const previous = cooldown.read();
            if (input.lifecycle.cooldown.mode === 'off' || previous.mode === 'off') {
                return;
            }
            const settled = await settleBenchmarkRuntime(
                input.lifecycle.cooldown,
                input.scope.signal,
                previous,
                createRuntimeCooldownDependencies()
            );
            cooldown.write(settled.evidence);
            if (settled.error !== null) {
                throw settled.error;
            }
        },
        async retainWarmup() {
            if (retained) {
                return;
            }
            retained = true;
            rawSamples = samples === 0
                ? { status: 'omitted', reference: null, reason: 'No warmup observations were collected.' }
                : await recordObservationSamples('benchmark-warmup-samples', observations);
        },
        snapshot() {
            return {
                version: benchmarkLifecycleVersion,
                garbageCollection: garbageCollection.snapshot(),
                policy: input.lifecycle,
                warmup: { samples, metrics: summarizeObservations(observations), rawSamples: { ...rawSamples } },
                cleanup: { ...cleanup },
                cooldown: { ...cooldown.read() }
            };
        }
    };
}
