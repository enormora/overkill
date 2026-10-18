import { CaseRunnerError, isCaseRunnerError } from '../engine/run-result.ts';
import type { BenchmarkLifecycle } from './benchmark-lifecycle.ts';
import type { SamplingSessionInput } from './benchmark-sampling-types.ts';
import { createAsyncMeasurementSample, createMeasurementSample } from './measurement-region.ts';

type SampleCleanupResult = { readonly callbacks: number; readonly failures: number; };
type SampleCleanup = {
    readonly register: (callback: () => Promise<void> | void) => void;
    readonly finish: () => Promise<SampleCleanupResult>;
};

function createSampleCleanup(reportError: (error: unknown) => void): SampleCleanup {
    const resources = new AsyncDisposableStack();
    const result = { callbacks: 0, failures: 0 };
    return {
        register(callback) {
            if (resources.disposed) {
                throw new TypeError('sample.cleanup() cannot be called after sample cleanup has started.');
            }
            if (typeof callback !== 'function') {
                throw new TypeError('sample.cleanup() requires a callback.');
            }
            resources.defer(async function disposeSampleResource() {
                result.callbacks += 1;
                try {
                    await callback();
                } catch (error: unknown) {
                    result.failures += 1;
                    reportError(error);
                }
            });
        },
        async finish() {
            await resources.disposeAsync();
            return result;
        }
    };
}

async function observeInvocation(
    input: SamplingSessionInput,
    cleanup: SampleCleanup,
    observe: (returned: unknown) => void
): Promise<void> {
    input.scope.signal.throwIfAborted();
    const lifecycle = input.measurement.mode === 'sync'
        ? createMeasurementSample(input.measurement, input.scope.signal)
        : createAsyncMeasurementSample(input.measurement, input.scope.signal);
    const returned: unknown = await Reflect.apply(input.body, undefined, [ {
        ...input.context,
        workload: input.workload,
        sample: { ...lifecycle.sample, cleanup: cleanup.register },
        signal: input.scope.signal,
        cleanup: input.scope.cleanup
    } ]);
    lifecycle.ensureMeasured();
    observe(returned);
}

type InvocationOutcome = { readonly kind: 'complete'; } | { readonly kind: 'failed'; readonly error: unknown; };

async function attemptInvocation(
    input: SamplingSessionInput,
    cleanup: SampleCleanup,
    observe: (returned: unknown) => void
): Promise<InvocationOutcome> {
    try {
        await observeInvocation(input, cleanup, observe);
        return { kind: 'complete' };
    } catch (error: unknown) {
        return { kind: 'failed', error };
    }
}

function collectAfterCleanup(input: SamplingSessionInput, failed: boolean, collectGarbage: () => void): void {
    try {
        collectGarbage();
    } catch (error: unknown) {
        if (failed && isCaseRunnerError(error)) {
            input.scope.reportError(error);
        } else {
            throw error;
        }
    }
}

export async function measureBenchmarkInvocation(
    input: SamplingSessionInput,
    observe: (returned: unknown) => void,
    lifecycle: Pick<BenchmarkLifecycle, 'garbageCollection' | 'recordCleanup'>
): Promise<void> {
    const cleanup = createSampleCleanup(input.scope.reportCleanupError);
    const invocation = await attemptInvocation(input, cleanup, observe);
    const result = await cleanup.finish();
    lifecycle.recordCleanup(result);
    collectAfterCleanup(
        input,
        invocation.kind === 'failed' || result.failures > 0,
        lifecycle.garbageCollection.collect
    );
    if (invocation.kind === 'failed') {
        throw invocation.error;
    }
    if (result.failures > 0) {
        throw new CaseRunnerError('Benchmark sample cleanup failed.', { subtype: 'measurement', cause: result });
    }
    input.scope.signal.throwIfAborted();
}
