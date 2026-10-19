import { setImmediate as yieldToNextTurn } from 'node:timers/promises';
import type { AssertionResult } from '../assertion-protocol/assertion-node.ts';
import { createSamplingState, type SamplingState } from './benchmark-sampling-state.ts';
import type { SamplingSessionInput } from './benchmark-sampling-types.ts';
import { createBenchmarkLifecycle, type BenchmarkLifecycle } from './benchmark-lifecycle.ts';
import { measureBenchmarkInvocation } from './benchmark-sample-lifetime.ts';
import { createProcessSamplingSession, type ProcessSamplingSession } from './process-sampling.ts';

const maximumSamplesPerTurn = 32;

async function warmBenchmark(
    input: SamplingSessionInput,
    state: SamplingState,
    lifecycle: BenchmarkLifecycle,
    processes: ProcessSamplingSession | null
): Promise<void> {
    while (lifecycle.warmupSamples() < input.lifecycle.warmupSamples) {
        await measureBenchmarkInvocation(
            input,
            lifecycle.observeWarmup,
            lifecycle,
            { processes, phase: 'warmup' }
        );
        await lifecycle.settle();
        if (lifecycle.warmupSamples() % maximumSamplesPerTurn === 0) {
            if (lifecycle.warmupSamples() < input.lifecycle.warmupSamples) {
                await state.progress();
            }
            await yieldToNextTurn(undefined, { signal: input.scope.signal });
        }
    }
    await state.progress();
}

async function collectSamples(
    input: SamplingSessionInput,
    state: SamplingState,
    lifecycle: BenchmarkLifecycle,
    processes: ProcessSamplingSession | null
): Promise<void> {
    while (state.samples() < input.policy.maximumSamples) {
        await measureBenchmarkInvocation(
            input,
            state.observe,
            lifecycle,
            { processes, phase: 'measured' }
        );
        await lifecycle.settle();
        if (await state.checkpoint()) {
            return;
        }
        if (state.samples() % maximumSamplesPerTurn === 0) {
            await yieldToNextTurn(undefined, { signal: input.scope.signal });
        }
    }
}

async function sampledExecution(
    input: SamplingSessionInput,
    lifecycle: BenchmarkLifecycle,
    state: SamplingState
): Promise<AssertionResult> {
    await state.progress();
    lifecycle.garbageCollection.validate();
    await using disposal = new AsyncDisposableStack();
    const processes = input.measurement.mode === 'process'
        ? createProcessSamplingSession(input.measurement, input.scope.signal)
        : null;
    disposal.defer(async function disposeProcesses() {
        await processes?.dispose();
    });
    await warmBenchmark(input, state, lifecycle, processes);
    await collectSamples(input, state, lifecycle, processes);
    return await state.finish();
}

export async function sampleBenchmark(input: SamplingSessionInput): Promise<AssertionResult> {
    const lifecycle = createBenchmarkLifecycle(input);
    const state = createSamplingState(input, lifecycle);
    try {
        return await sampledExecution(input, lifecycle, state);
    } catch (error: unknown) {
        return await state.interrupt(error);
    }
}
