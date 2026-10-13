import { types as runtimeTypes } from 'node:util';
import type {
    AsyncMeasurementSample,
    AsyncMeasurementStrategy,
    Measured,
    MeasurementSample,
    MeasurementStrategy,
    MetricReadings
} from './measurement-types.ts';
import { availableMetric, unavailableMetric } from './metric-reading.ts';
import { MeasurementContractError } from './measurement-contract-error.ts';
import {
    prepareAsyncMeasurementResources,
    prepareMeasurementResources,
    type AsyncMeasurementResources,
    type MeasurementResources
} from './measurement-resources.ts';
import { microsecondsPerSecond, nanosecondsPerMicrosecond } from './measurement-units.ts';

type RegionOperation<Value> = () => Promise<Value> | Value;
type RegionInput<Value> = readonly [number, RegionOperation<Value>] | readonly [RegionOperation<Value>];
type SampleLifecycle<Sample> = { readonly sample: Sample; readonly ensureMeasured: () => void; };
type Operation<Value> = { readonly count: number | null; readonly run: RegionOperation<Value>; };
type TimedValue<Value> = { readonly value: Value; readonly duration: number; };
type RegionGuard = { readonly begin: () => void; readonly finish: () => void; readonly ensureMeasured: () => void; };

function isOperationPromise<Value>(value: Promise<Value> | Value): value is Promise<Value> {
    return runtimeTypes.isPromise(value);
}

function operationInput<Value>(input: RegionInput<Value>): Operation<Value> {
    if (input.length === 1) {
        return { count: 1, run: input[0] };
    }
    const count = input[0];
    if (!Number.isSafeInteger(count) || count <= 0) {
        throw new MeasurementContractError('Operation count must be a positive safe integer.', {});
    }
    return { count, run: input[1] };
}

function regionMetrics(
    duration: number,
    count: number | null,
    readings: readonly MetricReadings[]
): Measured<unknown>['metrics'] {
    const collected = Object.fromEntries(readings.flatMap(function entries(reading) {
        return Object.entries(reading);
    }));
    const metrics = {
        ...collected,
        durationMicroseconds: availableMetric(duration, {
            collector: 'wall-clock',
            scope: 'region',
            unit: 'microseconds'
        })
    };
    const provenance = { collector: 'wall-clock', scope: 'region' as const, unit: 'operations/second' };
    return {
        ...metrics,
        operationsPerSecond: duration === 0
            ? unavailableMetric('Measured duration is zero.', provenance)
            : availableMetric((count ?? 1) * microsecondsPerSecond / duration, provenance)
    };
}

function elapsedMicroseconds(start: bigint): number {
    return Number(process.hrtime.bigint() - start) / nanosecondsPerMicrosecond;
}
async function awaitTimedValue<Value>(pending: Promise<Value>, start: bigint): Promise<TimedValue<Value>> {
    const value = await pending;
    return { value, duration: elapsedMicroseconds(start) };
}
function timedOperation<Value>(operation: RegionOperation<Value>): Promise<TimedValue<Value>> | TimedValue<Value> {
    const start = process.hrtime.bigint();
    const value = operation();
    return isOperationPromise(value) ? awaitTimedValue(value, start) : { value, duration: elapsedMicroseconds(start) };
}
function completeRegion<Value>(
    resources: MeasurementResources,
    timed: TimedValue<Value>,
    count: number | null
): Measured<Value> {
    resources.stop();
    const measured = { value: timed.value, metrics: regionMetrics(timed.duration, count, resources.complete()) };
    resources.dispose({ kind: 'success' });
    return measured;
}
async function awaitRegion<Value>(
    resources: MeasurementResources,
    timed: Promise<TimedValue<Value>>,
    count: number | null
): Promise<Measured<Value>> {
    try {
        return completeRegion(resources, await timed, count);
    } catch (error: unknown) {
        resources.dispose({ kind: 'failure', error });
        throw error;
    }
}
function executeRegion<Value>(
    resources: MeasurementResources,
    operation: Operation<Value>,
    signal: AbortSignal
): Measured<Value> | Promise<Measured<Value>> {
    signal.throwIfAborted();
    resources.start();
    const timed = timedOperation(operation.run);
    return timed instanceof Promise
        ? awaitRegion(resources, timed, operation.count)
        : completeRegion(resources, timed, operation.count);
}
function runRegion<Value>(
    strategy: MeasurementStrategy,
    signal: AbortSignal,
    input: RegionInput<Value>
): Measured<Value> | Promise<Measured<Value>> {
    const operation = operationInput(input);
    const resources = prepareMeasurementResources(strategy, signal);
    try {
        return executeRegion(resources, operation, signal);
    } catch (error: unknown) {
        resources.dispose({ kind: 'failure', error });
        throw error;
    }
}

function regionGuard(): RegionGuard {
    let begun = false;
    let finished = false;
    return {
        begin() {
            if (begun) {
                throw new MeasurementContractError('Each sample must contain exactly one measurement region.', {});
            }
            begun = true;
        },
        finish() {
            finished = true;
        },
        ensureMeasured() {
            if (!begun || !finished) {
                throw new MeasurementContractError(
                    'Each sample must await exactly one complete measurement region.',
                    {}
                );
            }
        }
    };
}
async function finishPendingRegion<Value>(
    pending: Promise<Measured<Value>>,
    guard: RegionGuard
): Promise<Measured<Value>> {
    const result = await pending;
    guard.finish();
    return result;
}

export function createMeasurementSample(
    strategy: MeasurementStrategy,
    signal: AbortSignal
): SampleLifecycle<MeasurementSample> {
    const guard = regionGuard();
    function measure(operation: () => never): never;
    function measure(operations: number, operation: () => never): never;
    function measure<Value>(operation: () => Promise<Value>): Promise<Measured<Value>>;
    function measure<Value>(operation: () => Value): Measured<Value>;
    function measure<Value>(operations: number, operation: () => Promise<Value>): Promise<Measured<Value>>;
    function measure<Value>(operations: number, operation: () => Value): Measured<Value>;
    function measure<Value>(...input: RegionInput<Value>): Measured<Value> | Promise<Measured<Value>> {
        guard.begin();
        const result = runRegion(strategy, signal, input);
        if (result instanceof Promise) {
            return finishPendingRegion(result, guard);
        }
        guard.finish();
        return result;
    }
    return { sample: { measure }, ensureMeasured: guard.ensureMeasured };
}

async function executeAsyncRegion<Value>(
    resources: AsyncMeasurementResources,
    operation: Operation<Value>,
    signal: AbortSignal
): Promise<Measured<Value>> {
    signal.throwIfAborted();
    resources.start();
    const returned = timedOperation(operation.run);
    const timed = returned instanceof Promise ? await returned : returned;
    resources.stop();
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
    const guard = regionGuard();
    const measure = async function measureRegion<Value>(...input: RegionInput<Value>): Promise<Measured<Value>> {
        guard.begin();
        const result = await runAsyncRegion(strategy, signal, input);
        guard.finish();
        return result;
    };
    return { sample: { measure }, ensureMeasured: guard.ensureMeasured };
}
