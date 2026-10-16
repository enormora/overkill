import {
    monitorEventLoopDelay,
    performance as runtimePerformance,
    PerformanceObserver as RuntimeObserver,
    type PerformanceEntry as RuntimeEntry
} from 'node:perf_hooks';
import { setTimeout as wait, setImmediate as nextTurn } from 'node:timers/promises';
import type { BenchmarkHostSnapshot, HostReading } from '../bench/benchmark-host-snapshot.ts';
import { cpuBusyPercent, readHostCpuTimes } from './benchmark-host-capacity.ts';
import { observeHost, observerMetric, unavailableHostReading } from './benchmark-host-reading.ts';
import { hostProcessMetrics, readHostProcessWindow } from './benchmark-host-process.ts';
import { RunCollectionError } from './run-errors.ts';

const observationMilliseconds = 250;
const nanosecondsPerMicrosecond = 1000;
const microsecondsPerMillisecond = 1000;
type HealthWindow = {
    readonly histogram: ReturnType<typeof monitorEventLoopDelay>;
    readonly observer: RuntimeObserver;
    readonly entries: readonly RuntimeEntry[];
    readonly startTime: number;
    readonly utilization: ReturnType<typeof runtimePerformance.eventLoopUtilization>;
};
type ObserverWindow = { readonly metrics: BenchmarkHostSnapshot['observer']; readonly complete: boolean; };
type HostObservation = { readonly cpuBusy: HostReading<number>; readonly metrics: BenchmarkHostSnapshot['observer']; };

function disposeHealthWindow(window: HealthWindow): void {
    try {
        try {
            window.histogram.disable();
        } finally {
            window.observer.disconnect();
        }
    } catch (error: unknown) {
        throw new RunCollectionError('Benchmark host observer cleanup failed.', { cause: error }, 'measurement');
    }
}

function beginHealthWindow(): HealthWindow {
    const histogram = monitorEventLoopDelay({ samplePerIteration: true });
    const entries: RuntimeEntry[] = [];
    const observer = new RuntimeObserver(function recordGc(list) {
        entries.push(...list.getEntries());
    });
    const window: HealthWindow = {
        histogram,
        observer,
        entries,
        startTime: runtimePerformance.now(),
        utilization: runtimePerformance.eventLoopUtilization()
    };
    try {
        observer.observe({ entryTypes: [ 'gc' ] });
        histogram.enable();
        return window;
    } catch (error: unknown) {
        disposeHealthWindow(window);
        throw error;
    }
}

function healthMetric(
    value: number | null,
    source: string,
    unit: string,
    reason: string
): BenchmarkHostSnapshot['observer'][string] {
    const reading = value === null
        ? unavailableHostReading<number>(source, 'process', unit, reason)
        : observeHost(source, 'process', unit, function nativeValue() {
            return value;
        });
    return observerMetric(reading, 'runtime');
}

function healthMetrics(window: HealthWindow, stopTime: number, utilization: number): BenchmarkHostSnapshot['observer'] {
    const entries = [ ...window.entries, ...window.observer.takeRecords() ].filter(function withinWindow(entry) {
        return entry.startTime >= window.startTime && entry.startTime <= stopTime;
    });
    const { histogram } = window;
    const gcDuration = entries.reduce(function totalDuration(total, entry) {
        return total + entry.duration;
    }, 0);
    return {
        eventLoopDelayMeanMicroseconds: healthMetric(
            histogram.count === 0 ? null : histogram.mean / nanosecondsPerMicrosecond,
            'monitorEventLoopDelay()',
            'microseconds',
            'No event-loop observations were collected.'
        ),
        eventLoopDelayMaximumMicroseconds: healthMetric(
            histogram.count === 0 ? null : histogram.max / nanosecondsPerMicrosecond,
            'monitorEventLoopDelay()',
            'microseconds',
            'No event-loop observations were collected.'
        ),
        eventLoopUtilization: healthMetric(utilization, 'performance.eventLoopUtilization()', 'ratio', ''),
        gcObservedCount: healthMetric(entries.length, 'PerformanceObserver(gc)', 'count', ''),
        gcObservedDurationMicroseconds: healthMetric(
            gcDuration * microsecondsPerMillisecond,
            'PerformanceObserver(gc)',
            'microseconds',
            ''
        )
    };
}

async function recordWindow(window: HealthWindow, signal: AbortSignal): Promise<BenchmarkHostSnapshot['observer']> {
    const before = readHostProcessWindow();
    await wait(observationMilliseconds, undefined, { signal });
    const after = readHostProcessWindow();
    const stopTime = runtimePerformance.now();
    const { utilization } = runtimePerformance.eventLoopUtilization(window.utilization);
    await nextTurn(undefined, { signal });
    await nextTurn(undefined, { signal });
    return { ...hostProcessMetrics(before, after), ...healthMetrics(window, stopTime, utilization) };
}

async function observeRuntime(signal: AbortSignal): Promise<ObserverWindow> {
    const window = beginHealthWindow();
    try {
        return { complete: true, metrics: await recordWindow(window, signal) };
    } finally {
        disposeHealthWindow(window);
    }
}

async function observeRuntimeOrUnavailable(signal: AbortSignal): Promise<ObserverWindow> {
    try {
        return await observeRuntime(signal);
    } catch (error: unknown) {
        if (error instanceof RunCollectionError) {
            throw error;
        }
        return {
            complete: false,
            metrics: {
                observation: observerMetric(
                    unavailableHostReading<number>(
                        'Node native host observation',
                        'process',
                        'status',
                        error instanceof Error
                            ? error.message
                            : String(error)
                    ),
                    'runtime'
                )
            }
        };
    }
}

export async function observeBenchmarkHostWindow(signal: AbortSignal): Promise<HostObservation> {
    const before = readHostCpuTimes();
    const observer = await observeRuntimeOrUnavailable(signal);
    const after = readHostCpuTimes();
    const cpuBusy = observer.complete && before.availability === 'available' && after.availability === 'available'
        ? cpuBusyPercent(before.value, after.value)
        : unavailableHostReading<number>(
            'os.cpus() CPU-time deltas',
            'host',
            'percent',
            'CPU observation window is incomplete.'
        );
    return { cpuBusy, metrics: observer.metrics };
}
