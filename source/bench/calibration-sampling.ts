import { setImmediate as yieldToNextTurn } from 'node:timers/promises';
import type {
    CalibrationIdentity,
    CalibrationResult,
    BenchmarkNormalizationContext
} from '../engine/benchmark-result.ts';
import { createBenchmarkLifecycle, type BenchmarkLifecycle } from './benchmark-lifecycle.ts';
import { measureBenchmarkInvocation } from './benchmark-sample-lifetime.ts';
import { createProcessSamplingSession, type ProcessSamplingSession } from './process-sampling.ts';
import { createCalibrationObservations, type CalibrationObservations } from './calibration-observations.ts';
import type { SamplingSessionInput } from './benchmark-sampling-types.ts';

const maximumSamplesPerTurn = 32;
async function yieldCalibrationTurn(index: number, signal: AbortSignal): Promise<void> {
    if ((index + 1) % maximumSamplesPerTurn === 0) {
        await yieldToNextTurn(undefined, { signal });
    }
}
export type CalibrationSamplingInput = Pick<
    SamplingSessionInput,
    'body' | 'budgets' | 'context' | 'diagnostics' | 'lifecycle' | 'measurement' | 'policy' | 'scope' | 'workload'
>;
function calibrationMachine(input: CalibrationSamplingInput): BenchmarkNormalizationContext['machine'] {
    const machine = input.scope.benchmarkEnvironment?.normalization?.machine;
    if (machine === undefined) {
        throw new TypeError('Calibration requires a benchmark runner reference context.');
    }
    return machine;
}
async function warmReference(
    input: CalibrationSamplingInput,
    lifecycle: BenchmarkLifecycle,
    processes: ProcessSamplingSession | null
): Promise<void> {
    for (let index = 0; index < input.lifecycle.warmupSamples; index += 1) {
        await measureBenchmarkInvocation(input, lifecycle.observeWarmup, lifecycle, { processes, phase: 'warmup' });
        await lifecycle.settle();
        await yieldCalibrationTurn(index, input.scope.signal);
    }
}
async function measuredReference(
    input: CalibrationSamplingInput,
    lifecycle: BenchmarkLifecycle,
    processes: ProcessSamplingSession | null,
    observations: CalibrationObservations
): Promise<CalibrationResult> {
    for (let index = 0; index < input.policy.maximumSamples; index += 1) {
        await measureBenchmarkInvocation(input, observations.observe, lifecycle, { processes, phase: 'measured' });
        await lifecycle.settle();
        await yieldCalibrationTurn(index, input.scope.signal);
        if (observations.checkpoint()) {
            return observations.result();
        }
    }
    return observations.result();
}
async function runCalibration(
    input: CalibrationSamplingInput,
    observations: CalibrationObservations
): Promise<CalibrationResult> {
    const lifecycle = createBenchmarkLifecycle(input);
    lifecycle.garbageCollection.validate();
    await using disposal = new AsyncDisposableStack();
    const processes = input.measurement.mode === 'process'
        ? createProcessSamplingSession(input.measurement, input.scope.signal)
        : null;
    disposal.defer(async function disposeCalibrationProcesses() {
        await processes?.dispose();
    });
    await warmReference(input, lifecycle, processes);
    return await measuredReference(input, lifecycle, processes, observations);
}
export async function sampleCalibration(
    identity: CalibrationIdentity,
    input: CalibrationSamplingInput
): Promise<CalibrationResult> {
    let observations: CalibrationObservations | null = null;
    try {
        const machine = calibrationMachine(input);
        observations = createCalibrationObservations({
            identity,
            ...machine,
            execution: { nodeVersion: process.versions.node, nodeArguments: Array.from(process.execArgv) },
            sampling: input.policy,
            lifecycle: input.lifecycle
        });
        return await runCalibration(input, observations);
    } catch (error: unknown) {
        return {
            kind: 'non-comparable',
            reason: error instanceof Error ? error.message : String(error),
            samples: observations?.samples() ?? []
        };
    }
}

type CalibrationSampler = {
    readonly identity: CalibrationIdentity;
    readonly sample: (input: CalibrationSamplingInput) => Promise<CalibrationResult>;
};
export function createCalibrationSampler(identity: CalibrationIdentity): CalibrationSampler {
    const references = new WeakMap<BenchmarkNormalizationContext, Promise<CalibrationResult>>();
    return {
        identity,
        async sample(input) {
            const key = input.scope.benchmarkEnvironment?.normalization;
            if (key === null || key === undefined) {
                return sampleCalibration(identity, input);
            }
            const pending = references.get(key) ?? sampleCalibration(identity, input);
            references.set(key, pending);
            return pending;
        }
    };
}
