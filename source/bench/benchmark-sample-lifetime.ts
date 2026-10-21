import { CaseRunnerError, isCaseRunnerError } from '../engine/run-result.ts';
import type { BenchmarkLifecycle } from './benchmark-lifecycle.ts';
import type { SamplingSessionInput } from './benchmark-sampling-types.ts';
import { createAsyncMeasurementSample, createMeasurementSample } from './measurement-region.ts';
import type { ProcessSamplingSession } from './process-sampling.ts';
import type { ProcessPhase } from './process-evidence.ts';
import { sampleTimeline, beginTimelineInvocation, timelineSpan } from './timeline-context.ts';

export type InvocationMeasurement = {
    readonly processes: ProcessSamplingSession | null;
    readonly phase: ProcessPhase;
};

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

export type BenchmarkInvocationInput = Pick<
    SamplingSessionInput,
    'body' | 'context' | 'lifecycle' | 'measurement' | 'scope' | 'workload'
>;

type FunctionSampleLifetime = ReturnType<typeof createAsyncMeasurementSample | typeof createMeasurementSample>;

function functionSample(input: BenchmarkInvocationInput): FunctionSampleLifetime {
    if (input.measurement.mode === 'sync') {
        return createMeasurementSample(input.measurement, input.scope.signal);
    }
    if (input.measurement.mode === 'async') {
        return createAsyncMeasurementSample(input.measurement, input.scope.signal);
    }
    throw new TypeError('Process sampling requires an owned process session.');
}

async function observeInvocation(
    input: BenchmarkInvocationInput,
    cleanup: SampleCleanup,
    observe: (returned: unknown) => void,
    measurement: InvocationMeasurement
): Promise<void> {
    input.scope.signal.throwIfAborted();
    await using disposal = new AsyncDisposableStack();
    const processes = measurement.processes?.sample(measurement.phase) ?? null;
    disposal.defer(async function disposeProcesses() {
        await processes?.dispose();
    });
    const lifecycle = processes ?? functionSample(input);
    const returned: unknown = await Reflect.apply(input.body, undefined, [ {
        ...input.context,
        workload: input.workload,
        sample: { ...lifecycle.sample, cleanup: cleanup.register, timeline: sampleTimeline },
        signal: input.scope.signal,
        cleanup: input.scope.cleanup
    } ]);
    lifecycle.ensureMeasured();
    observe(returned);
}

type InvocationOutcome = { readonly kind: 'complete'; } | { readonly kind: 'failed'; readonly error: unknown; };

async function attemptInvocation(
    input: BenchmarkInvocationInput,
    cleanup: SampleCleanup,
    observe: (returned: unknown) => void,
    measurement: InvocationMeasurement
): Promise<InvocationOutcome> {
    try {
        await timelineSpan('harness', 'invocation', async function prepareAndMeasure() {
            await observeInvocation(input, cleanup, observe, measurement);
        });
        return { kind: 'complete' };
    } catch (error: unknown) {
        return { kind: 'failed', error };
    }
}

function collectAfterCleanup(input: BenchmarkInvocationInput, failed: boolean, collectGarbage: () => void): void {
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

type InvocationLifecycle = Pick<BenchmarkLifecycle, 'garbageCollection' | 'recordCleanup'>;
function collectInvocationGarbage(
    input: BenchmarkInvocationInput,
    lifecycle: InvocationLifecycle,
    invocation: InvocationOutcome,
    result: SampleCleanupResult
): void {
    const collect = function collectAfterInvocation(): void {
        collectAfterCleanup(
            input,
            invocation.kind === 'failed' || result.failures > 0,
            lifecycle.garbageCollection.collect
        );
    };
    if (input.lifecycle.garbageCollection === 'after-sample') {
        timelineSpan('harness', 'forced GC', collect);
    } else {
        collect();
    }
}
async function completeInvocation(
    input: BenchmarkInvocationInput,
    lifecycle: InvocationLifecycle,
    cleanup: SampleCleanup,
    invocation: InvocationOutcome
): Promise<void> {
    const result = await timelineSpan('harness', 'sample cleanup', cleanup.finish);
    lifecycle.recordCleanup(result);
    collectInvocationGarbage(input, lifecycle, invocation, result);
    if (invocation.kind === 'failed') {
        throw invocation.error;
    }
    if (result.failures > 0) {
        throw new CaseRunnerError('Benchmark sample cleanup failed.', { subtype: 'measurement', cause: result });
    }
    input.scope.signal.throwIfAborted();
}

export async function measureBenchmarkInvocation(
    input: BenchmarkInvocationInput,
    observe: (returned: unknown) => void,
    lifecycle: InvocationLifecycle,
    measurement: InvocationMeasurement
): Promise<void> {
    beginTimelineInvocation(measurement.phase);
    const cleanup = createSampleCleanup(input.scope.reportCleanupError);
    const invocation = await attemptInvocation(input, cleanup, observe, measurement);
    await completeInvocation(input, lifecycle, cleanup, invocation);
}
