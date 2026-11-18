import { createStoredValue } from '../stored-value.ts';
import type {
    BenchmarkCooldownResult,
    BenchmarkLifecycleResult
} from '../engine/benchmark-result.ts';
import { settleMeasurementTarget } from './measurement-target-cooldown.ts';
import { createBenchmarkGarbageCollection, type BenchmarkGarbageCollection } from './benchmark-garbage-collection.ts';
import type { SamplingSessionInput } from './benchmark-sampling-types.ts';
import { commitObservation, createObservationSet, summarizeObservations } from './benchmark-observation-set.ts';
import { recordObservationSamples } from './benchmark-sampling-evidence.ts';
import { createMeasurementRecording, type MeasurementRecording } from './measurement-evidence.ts';
import { resolveMeasurementTarget, validateTargetCooldown } from './measurement-target.ts';
import { timelineSpan } from './timeline-context.ts';

export type BenchmarkLifecycle = {
    readonly measurement: MeasurementRecording;
    readonly validate: () => void;
    readonly garbageCollection: BenchmarkGarbageCollection;
    readonly warmupSamples: () => number;
    readonly observeWarmup: (returned: unknown) => void;
    readonly recordCleanup: (result: BenchmarkLifecycleResult['cleanup']) => void;
    readonly settle: () => Promise<void>;
    readonly retainWarmup: () => Promise<void>;
    readonly snapshot: () => BenchmarkLifecycleResult;
};

export function createBenchmarkLifecycle(
    input: Pick<SamplingSessionInput, 'budgets' | 'diagnostics' | 'lifecycle' | 'measurement' | 'scope'>
): BenchmarkLifecycle {
    const target = resolveMeasurementTarget(
        input.measurement,
        input.scope.benchmarkEnvironment?.garbageCollection ?? null
    );
    const measurement = createMeasurementRecording(input.scope, target, input.measurement);
    const observations = createObservationSet([
        ...input.budgets.map(function metricName(budget) {
            return budget.metric;
        }),
        ...input.diagnostics
    ]);
    const garbageCollection = createBenchmarkGarbageCollection(input, target);
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
        measurement,
        validate() {
            garbageCollection.validate();
            validateTargetCooldown(target, input.lifecycle.cooldown);
        },
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
            const policy = input.lifecycle.cooldown;
            const settled = await timelineSpan('harness', 'cooldown', async function settleRuntime() {
                return await settleMeasurementTarget(target, policy, input.scope.signal, previous);
            });
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
                measurement: measurement.snapshot(),
                garbageCollection: garbageCollection.snapshot(),
                policy: input.lifecycle,
                warmup: { samples, metrics: summarizeObservations(observations), rawSamples: { ...rawSamples } },
                cleanup: { ...cleanup },
                cooldown: { ...cooldown.read() }
            };
        }
    };
}
