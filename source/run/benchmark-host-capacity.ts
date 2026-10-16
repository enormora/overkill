import os from 'node:os';
import { percentScale } from '../config/benchmark-host.ts';
import type { BenchmarkHostSnapshot, HostReading } from '../bench/benchmark-host-snapshot.ts';
import { hostNumber, hostPercentage, observeHost, unavailableHostReading } from './benchmark-host-reading.ts';

export function readBenchmarkHostCapacity(): BenchmarkHostSnapshot['capacity'] {
    return {
        availableParallelism: hostNumber('os.availableParallelism()', 'process', 'count', os.availableParallelism),
        logicalCpuCount: hostNumber('os.cpus()', 'host', 'count', function cpuCount() {
            const count = os.cpus().length;
            if (count === 0) {
                throw new TypeError('Logical CPU count is unavailable.');
            }
            return count;
        }),
        cpuModels: observeHost('os.cpus()', 'host', 'model', function cpuModels() {
            return Array
                .from(
                    new Set(
                        os
                            .cpus()
                            .map(function model(cpu) {
                                return cpu.model;
                            })
                    )
                )
                .toSorted(function alphabetical(left, right) {
                    return left.localeCompare(right);
                });
        }),
        totalMemoryBytes: hostNumber('os.totalmem()', 'host', 'bytes', function totalMemory() {
            const bytes = os.totalmem();
            if (bytes === 0) {
                throw new TypeError('Physical memory capacity is unavailable.');
            }
            return bytes;
        }),
        freeMemoryBytes: hostNumber('os.freemem()', 'host', 'bytes', os.freemem),
        availableMemoryBytes: hostNumber('process.availableMemory()', 'process', 'bytes', process.availableMemory),
        constrainedMemoryBytes: hostNumber('process.constrainedMemory()', 'process', 'bytes', function constraint() {
            const value = process.constrainedMemory();
            if (!Number.isSafeInteger(value) || value <= 0) {
                throw new TypeError('Memory constraint is unknown or not imposed.');
            }
            return value;
        }),
        loadAverage: observeHost('os.loadavg()', 'host', 'load', function loadAverage() {
            const [ one, five, fifteen ] = os.loadavg();
            if (process.platform === 'win32') {
                throw new TypeError('Load average is unsupported on Windows.');
            }
            if (
                one === undefined || five === undefined || fifteen === undefined ||
                [ one, five, fifteen ].some(function validLoad(value) {
                    return !(Number.isFinite(value) && value >= 0);
                })
            ) {
                throw new TypeError('Load averages are unavailable.');
            }
            return [ one, five, fifteen ];
        })
    };
}

function effectiveMemoryCapacity(capacity: BenchmarkHostSnapshot['capacity']): HostReading<number> {
    const { totalMemoryBytes, constrainedMemoryBytes } = capacity;
    if (totalMemoryBytes.availability === 'unavailable' || constrainedMemoryBytes.availability === 'unavailable') {
        return totalMemoryBytes;
    }
    return { ...totalMemoryBytes, value: Math.min(totalMemoryBytes.value, constrainedMemoryBytes.value) };
}

type CpuTimeDelta = { readonly total: number; readonly idle: number; };

export function availableMemoryPercent(capacity: BenchmarkHostSnapshot['capacity']): HostReading<number> {
    const { availableMemoryBytes } = capacity;
    const denominator = effectiveMemoryCapacity(capacity);
    const reading = hostPercentage(
        'process.availableMemory()/effectiveMemoryCapacity',
        'process',
        availableMemoryBytes,
        denominator
    );
    return reading.availability === 'available' && reading.value > percentScale
        ? unavailableHostReading(
            reading.source,
            reading.scope,
            reading.unit,
            'Available memory exceeds known capacity.'
        )
        : reading;
}

export function hostLoadPerCpuPercent(capacity: BenchmarkHostSnapshot['capacity']): HostReading<number> {
    const { loadAverage } = capacity;
    const load = loadAverage.availability === 'available'
        ? { ...loadAverage, value: loadAverage.value[0] }
        : loadAverage;
    return hostPercentage('os.loadavg()[0]/os.cpus().length', 'host', load, capacity.logicalCpuCount);
}

function cpuTimeDelta(
    previous: Readonly<os.CpuInfo> | undefined,
    cpu: Readonly<os.CpuInfo>
): CpuTimeDelta {
    if (previous?.model !== cpu.model) {
        throw new TypeError('CPU set changed during observation.');
    }
    const counters = [ 'user', 'nice', 'sys', 'idle', 'irq' ] as const;
    const deltas = counters.map(function counter(key) {
        return cpu.times[key] - previous.times[key];
    });
    if (
        deltas.some(function reset(delta) {
            return !Number.isFinite(delta) || delta < 0;
        })
    ) {
        throw new TypeError('CPU counter reset during observation.');
    }
    return {
        total: deltas.reduce(function sum(total, delta) {
            return total + delta;
        }, 0),
        idle: cpu.times.idle - previous.times.idle
    };
}

export function cpuBusyPercent(before: readonly os.CpuInfo[], after: readonly os.CpuInfo[]): HostReading<number> {
    return hostNumber('os.cpus() CPU-time deltas', 'host', 'percent', function cpuTimeRatio() {
        if (before.length === 0 || before.length !== after.length) {
            throw new TypeError('CPU set changed or is unavailable.');
        }
        const deltas = after.map(function cpuDelta(cpu, index) {
            return cpuTimeDelta(before[index], cpu);
        });
        const total = deltas.reduce(function sum(value, delta) {
            return value + delta.total;
        }, 0);
        const idle = deltas.reduce(function sum(value, delta) {
            return value + delta.idle;
        }, 0);
        if (total <= 0) {
            throw new TypeError('No CPU-time observations were collected.');
        }
        return (total - idle) / total * percentScale;
    });
}

export function readHostCpuTimes(): HostReading<readonly os.CpuInfo[]> {
    return observeHost('os.cpus()', 'host', 'cpu-times', os.cpus);
}
