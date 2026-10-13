import type { MetricCollector, MetricDeclaration, MetricReadings } from './measurement-types.ts';
import { availableMetric, unavailableMetric } from './metric-reading.ts';
import { bytesPerBinaryKilobyte } from './measurement-units.ts';

function cpuCollector(scope: 'process' | 'thread'): MetricCollector {
    const name = `${scope}-cpu`;
    const read = scope === 'thread' ? process.threadCpuUsage : process.cpuUsage;
    const metrics = [ 'user', 'system', 'total' ].map(function cpuMetric(part): MetricDeclaration {
        return {
            name: `${scope}Cpu${part[0]?.toUpperCase()}${part.slice(1)}Microseconds`,
            collector: name,
            scope,
            unit: 'microseconds'
        };
    });

    return {
        name,
        mode: 'sync',
        metrics,
        prepare() {
            let before = { user: 0, system: 0 };
            let after = { user: 0, system: 0 };

            return {
                start() {
                    before = read();
                },
                stop() {
                    after = read();
                },
                complete() {
                    const user = after.user - before.user;
                    const system = after.system - before.system;
                    const values = [ user, system, user + system ];
                    return Object.fromEntries(metrics.map(function cpuReading(metric, index) {
                        return [ metric.name, availableMetric(values[index] ?? 0, metric) ];
                    }));
                },
                dispose() {
                    return undefined;
                }
            };
        }
    };
}

export function threadCpuCollector(): MetricCollector {
    return cpuCollector('thread');
}

export function processCpuCollector(): MetricCollector {
    return cpuCollector('process');
}

type MemorySnapshot = {
    readonly name: string;
    readonly value: number;
    readonly scope: 'process' | 'thread';
    readonly unit: string;
};

function memorySnapshot(): readonly MemorySnapshot[] {
    const memory = process.memoryUsage();
    return [
        { name: 'residentSetBytes', value: memory.rss, scope: 'process', unit: 'bytes' },
        { name: 'heapUsedBytes', value: memory.heapUsed, scope: 'thread', unit: 'bytes' },
        { name: 'heapTotalBytes', value: memory.heapTotal, scope: 'thread', unit: 'bytes' },
        { name: 'externalBytes', value: memory.external, scope: 'thread', unit: 'bytes' },
        { name: 'arrayBufferBytes', value: memory.arrayBuffers, scope: 'thread', unit: 'bytes' },
        { name: 'activeResourceCount', value: process.getActiveResourcesInfo().length, scope: 'process', unit: 'count' }
    ];
}

export function memoryCollector(): MetricCollector {
    const name = 'memory';
    const fields = [
        'residentSetBytes',
        'heapUsedBytes',
        'heapTotalBytes',
        'externalBytes',
        'arrayBufferBytes',
        'activeResourceCount'
    ];
    const declarations = fields.flatMap(function memoryMetrics(field): readonly MetricDeclaration[] {
        const metric = {
            name: field,
            scope: field === 'residentSetBytes' || field === 'activeResourceCount'
                ? 'process' as const
                : 'thread' as const,
            unit: field === 'activeResourceCount' ? 'count' : 'bytes'
        };
        return [
            { collector: name, name: metric.name, scope: metric.scope, unit: metric.unit },
            { collector: name, name: `${metric.name}Delta`, scope: metric.scope, unit: metric.unit }
        ];
    });

    return {
        name,
        mode: 'sync',
        metrics: declarations,
        prepare() {
            const before = new Map<string, number>();
            let after: readonly MemorySnapshot[] = [];
            return {
                start() {
                    for (const metric of memorySnapshot()) {
                        before.set(metric.name, metric.value);
                    }
                },
                stop() {
                    after = memorySnapshot();
                },
                complete() {
                    return Object.fromEntries(after.flatMap(function memoryReadings(metric) {
                        const provenance = { collector: name, scope: metric.scope, unit: metric.unit };
                        return [
                            [ metric.name, availableMetric(metric.value, provenance) ],
                            [
                                `${metric.name}Delta`,
                                availableMetric(metric.value - (before.get(metric.name) ?? metric.value), provenance)
                            ]
                        ];
                    }));
                },
                dispose() {
                    return undefined;
                }
            };
        }
    };
}

const resourceCounters = [
    'minorPageFault',
    'majorPageFault',
    'fsRead',
    'fsWrite',
    'voluntaryContextSwitches',
    'involuntaryContextSwitches'
];

export function processResourceCollector(): MetricCollector {
    const name = 'process-resources';
    const metrics: readonly MetricDeclaration[] = [
        { name: 'processMaximumResidentSetBytes', collector: name, scope: 'process', unit: 'bytes' },
        ...resourceCounters.map(function counterMetric(counter): MetricDeclaration {
            return { name: `${counter}Delta`, collector: name, scope: 'process', unit: 'count' };
        })
    ];
    return {
        name,
        mode: 'sync',
        metrics,
        prepare() {
            let before: ReturnType<typeof process.resourceUsage> | null = null;
            let after: ReturnType<typeof process.resourceUsage> | null = null;
            return {
                start() {
                    before = process.resourceUsage();
                },
                stop() {
                    after = process.resourceUsage();
                },
                complete(): MetricReadings {
                    const previousSnapshot = before;
                    const currentSnapshot = after;
                    if (previousSnapshot === null || currentSnapshot === null) {
                        throw new TypeError('Resource measurement requires start and stop.');
                    }
                    return Object.fromEntries(metrics.map(function resourceReading(metric) {
                        if (metric.name === 'processMaximumResidentSetBytes') {
                            return [
                                metric.name,
                                availableMetric(currentSnapshot.maxRSS * bytesPerBinaryKilobyte, metric)
                            ];
                        }

                        const counter = metric.name.slice(0, -'Delta'.length);
                        const value: unknown = Reflect.get(currentSnapshot, counter);
                        const previous: unknown = Reflect.get(previousSnapshot, counter);
                        const unsupported = process.platform === 'win32' &&
                            [ 'majorPageFault', 'voluntaryContextSwitches', 'involuntaryContextSwitches' ].includes(
                                counter
                            );
                        return [
                            metric.name,
                            !unsupported && typeof value === 'number' && typeof previous === 'number'
                                ? availableMetric(value - previous, metric)
                                : unavailableMetric('Counter unavailable on this platform.', metric)
                        ];
                    }));
                },
                dispose() {
                    return undefined;
                }
            };
        }
    };
}
