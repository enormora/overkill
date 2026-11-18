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
    readonly histogram: Pick<ReturnType<typeof monitorEventLoopDelay>, 'count' | 'disable' | 'enable' | 'max' | 'mean'>;
    readonly observer: Pick<RuntimeObserver, 'disconnect' | 'observe' | 'takeRecords'>;
    readonly entries: readonly RuntimeEntry[];
    readonly startTime: number;
    readonly utilization: Readonly<ReturnType<typeof runtimePerformance.eventLoopUtilization>>;
};
export type BenchmarkHostObservationRuntime = {
    readonly histogram: () => HealthWindow['histogram'];
    readonly observer: (record: (entries: readonly RuntimeEntry[]) => void) => HealthWindow['observer'];
    readonly now: () => number;
    readonly utilization: (previous: HealthWindow['utilization'] | null) => HealthWindow['utilization'];
    readonly processWindow: typeof readHostProcessWindow;
    readonly cpu: typeof readHostCpuTimes;
    readonly wait: (milliseconds: number, signal: AbortSignal) => Promise<void>;
    readonly settle: (signal: AbortSignal) => Promise<void>;
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

function beginHealthWindow(runtime: BenchmarkHostObservationRuntime): HealthWindow {
    const histogram = runtime.histogram();
    const entries: RuntimeEntry[] = [];
    const observer = runtime.observer(function recordGc(records) {
        entries.push(...records);
    });
    const window: HealthWindow = {
        histogram,
        observer,
        entries,
        startTime: runtime.now(),
        utilization: runtime.utilization(null)
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

async function recordWindow(
    window: HealthWindow,
    signal: AbortSignal,
    runtime: BenchmarkHostObservationRuntime
): Promise<BenchmarkHostSnapshot['observer']> {
    const before = runtime.processWindow();
    await runtime.wait(observationMilliseconds, signal);
    const after = runtime.processWindow();
    const stopTime = runtime.now();
    const { utilization } = runtime.utilization(window.utilization);
    await runtime.settle(signal);
    await runtime.settle(signal);
    return { ...hostProcessMetrics(before, after), ...healthMetrics(window, stopTime, utilization) };
}

async function observeRuntime(signal: AbortSignal, runtime: BenchmarkHostObservationRuntime): Promise<ObserverWindow> {
    const window = beginHealthWindow(runtime);
    try {
        return { complete: true, metrics: await recordWindow(window, signal, runtime) };
    } finally {
        disposeHealthWindow(window);
    }
}

async function observeRuntimeOrUnavailable(
    signal: AbortSignal,
    runtime: BenchmarkHostObservationRuntime
): Promise<ObserverWindow> {
    try {
        return await observeRuntime(signal, runtime);
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

export async function observeBenchmarkHost(
    signal: AbortSignal,
    runtime: BenchmarkHostObservationRuntime
): Promise<HostObservation> {
    const before = runtime.cpu();
    const observer = await observeRuntimeOrUnavailable(signal, runtime);
    const after = runtime.cpu();
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

export async function observeBenchmarkHostWindow(signal: AbortSignal): Promise<HostObservation> {
    return await observeBenchmarkHost(signal, {
        histogram() {
            return monitorEventLoopDelay({ samplePerIteration: true });
        },
        observer(record) {
            return new RuntimeObserver(function records(list) {
                record(list.getEntries());
            });
        },
        now: runtimePerformance.now,
        utilization(previous) {
            return previous === null
                ? runtimePerformance.eventLoopUtilization()
                : runtimePerformance.eventLoopUtilization(previous);
        },
        processWindow: readHostProcessWindow,
        cpu: readHostCpuTimes,
        async wait(milliseconds, cancellation) {
            await wait(milliseconds, undefined, { signal: cancellation });
        },
        async settle(cancellation) {
            await nextTurn(undefined, { signal: cancellation });
        }
    });
}
