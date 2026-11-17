import { types as runtimeTypes } from 'node:util';
import { regionMetrics } from './measurement-region-readings.ts';
import type {
    AsyncMeasurementSample,
    AsyncMeasurementStrategy,
    Measured,
    MeasurementSample,
    MeasurementStrategy
} from './measurement-types.ts';
import { MeasurementContractError } from './measurement-contract-error.ts';
import { timelineSpan } from './timeline-context.ts';
import { prepareMeasurementResources, type MeasurementResources } from './measurement-resources.ts';
import { prepareAsyncMeasurementResources, type AsyncMeasurementResources } from './async-measurement-resources.ts';
import { currentMeasurementContext, measurementContext, measurementContextFor } from './measurement-context.ts';
import { awaitMeasurement } from './measurement-shutdown.ts';
import { createMeasurementRegionLifetime } from './measurement-region-lifetime.ts';

type RegionOperation<Value> = () => Promise<Value> | Value;
type RegionInput<Value> = readonly [number, RegionOperation<Value>] | readonly [RegionOperation<Value>];
type SampleLifecycle<Sample> = {
    readonly sample: Sample;
    readonly ensureMeasured: () => void;
    readonly dispose: () => Promise<void>;
};
type Operation<Value> = { readonly count: number; readonly run: RegionOperation<Value>; };
type TimedValue<Value> = { readonly value: Value; readonly duration: number; };

function operationInput<Value>(input: RegionInput<Value>): Operation<Value> {
    const count = input.length === 1 ? 1 : input[0];
    const run = input.length === 1 ? input[0] : input[1];
    if (!Number.isSafeInteger(count) || count <= 0) {
        throw new MeasurementContractError('Operation count must be a positive safe integer.', {});
    }
    if (typeof run !== 'function') {
        throw new MeasurementContractError('Measurement region requires an operation function.', {});
    }
    return { count, run };
}
function elapsedMicroseconds(start: number): number {
    const duration = currentMeasurementContext().target.nowMicroseconds() - start;
    if (!Number.isFinite(duration) || duration < 0) {
        throw new MeasurementContractError('Measurement clock must produce a finite nonnegative interval.', {});
    }
    return duration;
}
async function awaitTimedValue<Value>(pending: Promise<Value>, start: number): Promise<TimedValue<Value>> {
    const value = await pending;
    return { value, duration: elapsedMicroseconds(start) };
}
function timedOperation<Value>(operation: RegionOperation<Value>): Promise<TimedValue<Value>> | TimedValue<Value> {
    const start = currentMeasurementContext().target.nowMicroseconds();
    const value = timelineSpan('harness', 'measurement', operation);
    return runtimeTypes.isPromise(value)
        ? awaitTimedValue(value, start)
        : { value, duration: elapsedMicroseconds(start) };
}
function completeRegion<Value>(
    resources: MeasurementResources,
    timed: TimedValue<Value>,
    count: number
): Measured<Value> {
    resources.recordDuration(timed.duration);
    resources.stop();
    const result = { value: timed.value, metrics: regionMetrics(timed.duration, count, resources.complete()) };
    resources.dispose({ kind: 'success' });
    return result;
}
async function awaitRegion<Value>(
    resources: MeasurementResources,
    pending: Promise<TimedValue<Value>>,
    count: number,
    signal: AbortSignal
): Promise<Measured<Value>> {
    try {
        return completeRegion(resources, await awaitMeasurement(pending, signal), count);
    } catch (error: unknown) {
        resources.dispose({ kind: 'failure', error });
        throw error;
    }
}
function runRegion<Value>(
    strategy: MeasurementStrategy,
    signal: AbortSignal,
    input: RegionInput<Value>
): Measured<Value> | Promise<Measured<Value>> {
    const operation = operationInput(input);
    const resources = prepareMeasurementResources(strategy, signal);
    const execute = function executeRegion(): Measured<Value> | Promise<Measured<Value>> {
        signal.throwIfAborted();
        resources.start();
        const timed = timedOperation(operation.run);
        return timed instanceof Promise
            ? awaitRegion(resources, timed, operation.count, signal)
            : completeRegion(resources, timed, operation.count);
    };
    try {
        return execute();
    } catch (error: unknown) {
        resources.dispose({ kind: 'failure', error });
        throw error;
    }
}
export function createMeasurementSample(
    strategy: MeasurementStrategy,
    signal: AbortSignal
): SampleLifecycle<MeasurementSample> {
    const guard = createMeasurementRegionLifetime(signal);
    const context = measurementContextFor(strategy);
    function measure(operation: () => never): never;
    function measure(operations: number, operation: () => never): never;
    function measure<Value>(operation: () => Promise<Value>): Promise<Measured<Value>>;
    function measure<Value>(operation: () => Value): Measured<Value>;
    function measure<Value>(operations: number, operation: () => Promise<Value>): Promise<Measured<Value>>;
    function measure<Value>(operations: number, operation: () => Value): Measured<Value>;
    function measure<Value>(...input: RegionInput<Value>): Measured<Value> | Promise<Measured<Value>> {
        guard.begin();
        const result = measurementContext.run(
            context,
            function measureRegion(): Measured<Value> | Promise<Measured<Value>> {
                return runRegion(strategy, guard.signal, input);
            }
        );
        if (result instanceof Promise) {
            return guard.track(result).completion;
        }
        guard.finish();
        return result;
    }
    return { sample: { measure }, ensureMeasured: guard.ensureMeasured, dispose: guard.dispose };
}
async function executeAsyncRegion<Value>(
    resources: AsyncMeasurementResources,
    operation: Operation<Value>,
    signal: AbortSignal
): Promise<Measured<Value>> {
    signal.throwIfAborted();
    await resources.start();
    const returned = timedOperation(operation.run);
    const timed = returned instanceof Promise ? await awaitMeasurement(returned, signal) : returned;
    resources.recordDuration(timed.duration);
    await resources.stop();
    const result = {
        value: timed.value,
        metrics: regionMetrics(timed.duration, operation.count, await resources.complete())
    };
    await resources.dispose({ kind: 'success' });
    return result;
}
async function runAsyncRegion<Value>(
    strategy: AsyncMeasurementStrategy,
    signal: AbortSignal,
    input: RegionInput<Value>
): Promise<Measured<Value>> {
    const operation = operationInput(input);
    const resources = await prepareAsyncMeasurementResources(strategy, signal);
    try {
        return await executeAsyncRegion(resources, operation, signal);
    } catch (error: unknown) {
        await resources.dispose({ kind: 'failure', error });
        throw error;
    }
}
export function createAsyncMeasurementSample(
    strategy: AsyncMeasurementStrategy,
    signal: AbortSignal
): SampleLifecycle<AsyncMeasurementSample> {
    const guard = createMeasurementRegionLifetime(signal);
    const context = measurementContextFor(strategy);
    // eslint-disable-next-line @typescript-eslint/promise-function-async -- Return the owned promise so unawaited calls remain observed.
    const measure = function measureRegion<Value>(...input: RegionInput<Value>): Promise<Measured<Value>> {
        guard.begin();
        const region = measurementContext.run(context, async function measureAsyncRegion() {
            return await runAsyncRegion(strategy, guard.signal, input);
        });
        return guard.track(region).completion;
    };
    return { sample: { measure }, ensureMeasured: guard.ensureMeasured, dispose: guard.dispose };
}
