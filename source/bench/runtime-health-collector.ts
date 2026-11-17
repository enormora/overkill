import {
    monitorEventLoopDelay,
    performance as runtimePerformance,
    PerformanceObserver as RuntimeObserver,
    type PerformanceEntry as RuntimeEntry
} from 'node:perf_hooks';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { validateExecutingMeasurementTarget } from './measurement-target.ts';
import type {
    AsyncCollectorSession,
    AsyncCollectorPreparationContext,
    AsyncMetricCollector,
    MetricDeclaration,
    MetricReadings
} from './measurement-types.ts';
import { availableMetric, unavailableMetric } from './metric-reading.ts';
import { microsecondsPerMillisecond, nanosecondsPerMicrosecond } from './measurement-units.ts';

const metrics: readonly MetricDeclaration[] = [
    { name: 'eventLoopDelayMeanMicroseconds', collector: 'runtime-health', scope: 'runtime', unit: 'microseconds' },
    { name: 'eventLoopDelayMaximumMicroseconds', collector: 'runtime-health', scope: 'runtime', unit: 'microseconds' },
    { name: 'eventLoopUtilization', collector: 'runtime-health', scope: 'thread', unit: 'ratio' },
    { name: 'gcObservedCount', collector: 'runtime-health', scope: 'runtime', unit: 'count' },
    { name: 'gcObservedDurationMicroseconds', collector: 'runtime-health', scope: 'runtime', unit: 'microseconds' }
];

export function runtimeHealthReadings(values: readonly (number | null)[]): MetricReadings {
    return Object.fromEntries(metrics.map(function healthReading(metric, index) {
        const value = values[index];
        return [
            metric.name,
            value === undefined || value === null
                ? unavailableMetric('No event-loop observations were collected.', metric)
                : availableMetric(value, metric)
        ];
    }));
}

async function drainObserver(signal: AbortSignal): Promise<void> {
    await nextTurn(undefined, { signal });
    await nextTurn(undefined, { signal });
}

function runtimeSession(context: AsyncCollectorPreparationContext): AsyncCollectorSession {
    const histogram = monitorEventLoopDelay({ samplePerIteration: true });
    const state = {
        startTime: Number.POSITIVE_INFINITY,
        stopTime: Number.POSITIVE_INFINITY,
        count: 0,
        duration: 0,
        utilization: runtimePerformance.eventLoopUtilization(),
        elapsedUtilization: 0
    };
    let delayReadings: readonly (number | null)[] = [ null, null ];
    const record = function recordGc(entries: readonly RuntimeEntry[]): void {
        const observed = entries.filter(function withinRegion(entry) {
            return entry.startTime >= state.startTime && entry.startTime <= state.stopTime;
        });
        for (const entry of observed) {
            state.count += 1;
            state.duration += entry.duration * microsecondsPerMillisecond;
        }
    };
    const observer = new RuntimeObserver(function observeGc(list) {
        record(list.getEntries());
    });
    context.cleanup.defer(function releaseRuntimeObserver() {
        histogram.disable();
        observer.disconnect();
    });
    observer.observe({ entryTypes: [ 'gc' ] });
    histogram.enable();
    return {
        start() {
            histogram.reset();
            observer.takeRecords();
            state.count = 0;
            state.duration = 0;
            state.stopTime = Number.POSITIVE_INFINITY;
            state.utilization = runtimePerformance.eventLoopUtilization();
            state.startTime = runtimePerformance.now();
        },
        stop() {
            state.stopTime = runtimePerformance.now();
            state.elapsedUtilization = runtimePerformance.eventLoopUtilization(state.utilization).utilization;
            histogram.disable();
            delayReadings = [
                histogram.count === 0 ? null : histogram.mean / nanosecondsPerMicrosecond,
                histogram.count === 0 ? null : histogram.max / nanosecondsPerMicrosecond
            ];
        },
        async finalize(finalization) {
            await drainObserver(finalization.signal);
            record(observer.takeRecords());
            return finalization.readings(runtimeHealthReadings([
                ...delayReadings,
                state.elapsedUtilization,
                state.count,
                state.duration
            ]));
        }
    };
}

export function runtimeHealthCollector(): AsyncMetricCollector {
    return {
        version: '1',
        name: 'runtime-health',
        mode: 'async',
        metrics,
        async prepare(context) {
            context.signal.throwIfAborted();
            validateExecutingMeasurementTarget(context);
            const session = runtimeSession(context);
            await drainObserver(context.signal);
            return session;
        }
    };
}
