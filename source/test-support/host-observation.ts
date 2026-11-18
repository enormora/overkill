import type { PerformanceEntry as RuntimeEntry } from 'node:perf_hooks';
import { testDouble } from '../packages/test/test.entry-point.ts';
import type { BenchmarkHostObservationRuntime } from '../run/benchmark-host-observer.ts';
import { unavailableHostReading } from '../run/benchmark-host-reading.ts';
import { createStoredValue } from '../stored-value.ts';

export type HostObservationScenario = {
    readonly count: number;
    readonly waitFailure: unknown;
    readonly beginFailure: Error | null;
    readonly cleanupFailure: Error | null;
    readonly cpuAvailable: boolean;
};
export const hostObservationScenario: HostObservationScenario = {
    count: 2,
    waitFailure: null,
    beginFailure: null,
    cleanupFailure: null,
    cpuAvailable: true
};
type GarbageCollectionSample = Pick<RuntimeEntry, 'duration' | 'startTime'>;
const observationWindow = { start: 100, stop: 350 };
function gcEntry(sample: GarbageCollectionSample): RuntimeEntry {
    const { startTime, duration } = sample;
    return {
        name: 'gc',
        entryType: 'gc',
        startTime,
        duration,
        toJSON() {
            return { startTime, duration };
        }
    };
}
type HostObservation = { readonly runtime: BenchmarkHostObservationRuntime; readonly events: readonly string[]; };
export function hostObservation(input: HostObservationScenario): HostObservation {
    const events: string[] = [];
    const record = createStoredValue<(entries: readonly RuntimeEntry[]) => void>(function () {
        return undefined;
    });
    let cpuReads = 0;
    let clockReads = 0;
    const unavailable = unavailableHostReading<never>('unit', 'process', 'count', 'not sampled');
    const runtime: BenchmarkHostObservationRuntime = {
        histogram() {
            return {
                count: input.count,
                mean: 2000,
                max: 5000,
                enable() {
                    events.push('enable');
                    return true;
                },
                disable() {
                    events.push('disable');
                    if (input.cleanupFailure !== null) {
                        throw input.cleanupFailure;
                    }
                    return true;
                }
            };
        },
        observer(receive) {
            record.write(receive);
            return {
                observe() {
                    events.push('observe');
                    if (input.beginFailure !== null) {
                        throw input.beginFailure;
                    }
                },
                disconnect() {
                    events.push('disconnect');
                },
                takeRecords() {
                    return [
                        gcEntry({ startTime: 50, duration: 99 }),
                        gcEntry({ startTime: 200, duration: 2 }),
                        gcEntry({ startTime: 400, duration: 99 })
                    ];
                }
            };
        },
        now() {
            clockReads += 1;
            return clockReads === 1 ? observationWindow.start : observationWindow.stop;
        },
        utilization() {
            return { idle: 1, active: 3, utilization: 0.75 };
        },
        processWindow() {
            return { activeResourceCount: unavailable, cpu: unavailable, memory: unavailable, resources: unavailable };
        },
        cpu() {
            cpuReads += 1;
            return input.cpuAvailable
                ? {
                    availability: 'available',
                    source: 'unit',
                    scope: 'host',
                    unit: 'ticks',
                    value: [ {
                        model: 'unit',
                        speed: 1000,
                        times: {
                            ...cpuReads === 1 ? { user: 50, idle: 50 } : { user: 200, idle: 100 },
                            nice: 0,
                            sys: 0,

                            irq: 0
                        }
                    } ]
                }
                : unavailable;
        },
        async wait(milliseconds, signal) {
            events.push(`wait:${milliseconds}`);
            signal.throwIfAborted();
            if (input.waitFailure !== null) {
                testDouble.throws<() => void>(input.waitFailure)();
                return;
            }
            record.read()([ gcEntry({ startTime: 150, duration: 1 }) ]);
        },
        async settle(signal) {
            signal.throwIfAborted();
            events.push('settle');
        }
    };
    return { runtime, events };
}
