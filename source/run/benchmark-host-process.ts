import type { BenchmarkHostSnapshot, HostReading } from '../bench/benchmark-host-snapshot.ts';
import { observeHost, observerMetric } from './benchmark-host-reading.ts';

export type ProcessWindow = {
    readonly activeResourceCount: HostReading<number>;
    readonly cpu: HostReading<ReturnType<typeof process.cpuUsage>>;
    readonly memory: HostReading<ReturnType<typeof process.memoryUsage>>;
    readonly resources: HostReading<ReturnType<typeof process.resourceUsage>>;
};
export type HostProcessMetrics = BenchmarkHostSnapshot['observer'];

const bytesPerBinaryKilobyte = 1024;
const resourceCounters = [
    'minorPageFault',
    'majorPageFault',
    'fsRead',
    'fsWrite',
    'voluntaryContextSwitches',
    'involuntaryContextSwitches'
] as const;
const memoryFields = {
    residentSetBytes: 'rss',
    heapTotalBytes: 'heapTotal',
    heapUsedBytes: 'heapUsed',
    externalBytes: 'external',
    arrayBufferBytes: 'arrayBuffers'
} as const;

export function readHostProcessWindow(): ProcessWindow {
    return {
        activeResourceCount: observeHost(
            'process.getActiveResourcesInfo()',
            'process',
            'count',
            function activeResources() {
                return process.getActiveResourcesInfo().length;
            }
        ),
        cpu: observeHost('process.cpuUsage()', 'process', 'microseconds', process.cpuUsage),
        memory: observeHost('process.memoryUsage()', 'process', 'bytes', process.memoryUsage),
        resources: observeHost('process.resourceUsage()', 'process', 'count', process.resourceUsage)
    };
}

function windowValue<Value>(reading: HostReading<Value>): Value {
    if (reading.availability === 'unavailable') {
        throw new TypeError(reading.reason);
    }
    return reading.value;
}

function processMetric(
    source: string,
    unit: string,
    read: () => number,
    scope: 'process' | 'thread'
): BenchmarkHostSnapshot['observer'][string] {
    return observerMetric(observeHost(source, 'process', unit, read), scope);
}

export function hostProcessMetrics(before: ProcessWindow, after: ProcessWindow): HostProcessMetrics {
    const cpu = Object.fromEntries([ 'user', 'system', 'total' ].map(function cpuMetric(field) {
        return [
            `processCpu${field.charAt(0).toUpperCase()}${field.slice(1)}Microseconds`,
            processMetric('process.cpuUsage() delta', 'microseconds', function elapsedCpu() {
                const start = windowValue(before.cpu);
                const end = windowValue(after.cpu);
                if (field === 'total') {
                    return end.user + end.system - start.user - start.system;
                }
                return field === 'user' ? end.user - start.user : end.system - start.system;
            }, 'process')
        ];
    }));
    const memory = Object.fromEntries(
        Object.entries(memoryFields).flatMap(function memoryMetric([ name, field ]) {
            return [
                [
                    name,
                    processMetric('process.memoryUsage()', 'bytes', function memoryValue() {
                        return windowValue(after.memory)[field];
                    }, field === 'rss' ? 'process' : 'thread')
                ],
                [
                    `${name}Delta`,
                    processMetric('process.memoryUsage() delta', 'bytes', function memoryDelta() {
                        return windowValue(after.memory)[field] - windowValue(before.memory)[field];
                    }, field === 'rss' ? 'process' : 'thread')
                ]
            ];
        })
    );
    const resources = Object.fromEntries(resourceCounters.map(function resourceMetric(field) {
        return [
            `${field}Delta`,
            processMetric('process.resourceUsage() delta', 'count', function resourceDelta() {
                if (
                    process.platform === 'win32' &&
                    [ 'majorPageFault', 'voluntaryContextSwitches', 'involuntaryContextSwitches' ].includes(field)
                ) {
                    throw new TypeError('Counter unavailable on this platform.');
                }
                return windowValue(after.resources)[field] - windowValue(before.resources)[field];
            }, 'process')
        ];
    }));
    return {
        ...cpu,
        ...memory,
        ...resources,
        activeResourceCount: processMetric('process.getActiveResourcesInfo()', 'count', function activeResources() {
            return windowValue(after.activeResourceCount);
        }, 'process'),
        activeResourceCountDelta: processMetric(
            'process.getActiveResourcesInfo() delta',
            'count',
            function resourceCountDelta() {
                return windowValue(after.activeResourceCount) - windowValue(before.activeResourceCount);
            },
            'process'
        ),
        processMaximumResidentSetBytes: processMetric(
            'process.resourceUsage().maxRSS',
            'bytes',
            function maximumResidentSet() {
                return windowValue(after.resources).maxRSS * bytesPerBinaryKilobyte;
            },
            'process'
        )
    };
}
