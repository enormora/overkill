import { setImmediate as yieldToNextTurn } from 'node:timers/promises';
import type { AssertionResult } from '../assertion-protocol/assertion-node.ts';
import { createAsyncMeasurementSample, createMeasurementSample } from './measurement-region.ts';
import { createSamplingState, type SamplingState } from './benchmark-sampling-state.ts';
import type { SamplingSessionInput } from './benchmark-sampling-types.ts';

const maximumSamplesPerTurn = 32;

async function measureNextSample(input: SamplingSessionInput): Promise<unknown> {
    input.scope.signal.throwIfAborted();
    const lifecycle = input.measurement.mode === 'sync'
        ? createMeasurementSample(input.measurement, input.scope.signal)
        : createAsyncMeasurementSample(input.measurement, input.scope.signal);
    const returned: unknown = await Reflect.apply(input.body, undefined, [ {
        ...input.context,
        workload: input.workload,
        sample: lifecycle.sample,
        signal: input.scope.signal,
        cleanup: input.scope.cleanup
    } ]);
    lifecycle.ensureMeasured();
    return returned;
}

async function collectSamples(input: SamplingSessionInput, state: SamplingState): Promise<void> {
    while (state.samples() < input.policy.maximumSamples) {
        state.observe(await measureNextSample(input));
        if (await state.checkpoint()) {
            return;
        }
        if (state.samples() % maximumSamplesPerTurn === 0) {
            await yieldToNextTurn(undefined, { signal: input.scope.signal });
        }
    }
}

async function collectAndFinish(input: SamplingSessionInput, state: SamplingState): Promise<AssertionResult> {
    await collectSamples(input, state);
    return await state.finish();
}

export async function sampleBenchmark(input: SamplingSessionInput): Promise<AssertionResult> {
    const state = createSamplingState(input);
    try {
        return await collectAndFinish(input, state);
    } catch (error: unknown) {
        return await state.interrupt(error);
    }
}
