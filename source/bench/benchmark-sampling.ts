import { setImmediate as yieldToNextTurn } from 'node:timers/promises';
import type { AssertionResult } from '../assertion-protocol/assertion-node.ts';
import { createSamplingState, type SamplingState } from './benchmark-sampling-state.ts';
import type { SamplingSessionInput } from './benchmark-sampling-types.ts';
import { createBenchmarkLifecycle, type BenchmarkLifecycle } from './benchmark-lifecycle.ts';
import { measureBenchmarkInvocation } from './benchmark-sample-lifetime.ts';

const maximumSamplesPerTurn = 32;

async function warmBenchmark(
    input: SamplingSessionInput,
    state: SamplingState,
    lifecycle: BenchmarkLifecycle
): Promise<void> {
    while (lifecycle.warmupSamples() < input.lifecycle.warmupSamples) {
        await measureBenchmarkInvocation(
            input,
            lifecycle.observeWarmup,
            lifecycle
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
    lifecycle: BenchmarkLifecycle
): Promise<void> {
    while (state.samples() < input.policy.maximumSamples) {
        await measureBenchmarkInvocation(
            input,
            state.observe,
            lifecycle
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

export async function sampleBenchmark(input: SamplingSessionInput): Promise<AssertionResult> {
    const lifecycle = createBenchmarkLifecycle(input);
    const state = createSamplingState(input, lifecycle);
    try {
        await state.progress();
        lifecycle.garbageCollection.validate();
        await warmBenchmark(input, state, lifecycle);
        await collectSamples(input, state, lifecycle);
        return await state.finish();
    } catch (error: unknown) {
        return await state.interrupt(error);
    }
}
