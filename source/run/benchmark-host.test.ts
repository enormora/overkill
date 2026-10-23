import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { benchmarkHostLimitsSchema } from '../config/benchmark-host.ts';
import { benchmarkHostSnapshot } from '../test-support/benchmark-host-snapshot.ts';
import { evaluateBenchmarkHost } from '../bench/benchmark-host-assessment.ts';
import { parseLinuxPressure } from './benchmark-host-platform.ts';
import { parseDarwinCpuLimits } from './benchmark-host-darwin.ts';
import { availableMemoryPercent, cpuBusyPercent, hostLoadPerCpuPercent } from './benchmark-host-capacity.ts';
import {
    hostProcessMetrics,
    readHostProcessWindow,
    type HostProcessMetrics,
    type ProcessWindow
} from './benchmark-host-process.ts';
import { unavailableHostReading } from './benchmark-host-reading.ts';

const psi = 'some avg10=1.25 avg60=2.50 avg300=3.75 total=1234\nfull avg10=0.00 avg60=0.00 avg300=0.00 total=0\n';

function assertRelativeReadings(scope: TestScope): void {
    const { capacity } = benchmarkHostSnapshot();
    scope.assert.partialDeepEqual(availableMemoryPercent(capacity), { availability: 'available', value: 20 });
    scope.assert.partialDeepEqual(hostLoadPerCpuPercent(capacity), { availability: 'available', value: 50 });
    const scaled = {
        ...capacity,
        logicalCpuCount: { ...capacity.logicalCpuCount, availability: 'available' as const, value: 16 },
        constrainedMemoryBytes: { ...capacity.constrainedMemoryBytes, availability: 'available' as const, value: 1000 }
    };
    scope.assert.partialDeepEqual(availableMemoryPercent(scaled), { availability: 'available', value: 10 });
    scope.assert.partialDeepEqual(hostLoadPerCpuPercent(scaled), { availability: 'available', value: 25 });
    const unconstrained = {
        ...capacity,
        constrainedMemoryBytes: unavailableHostReading<number>('node', 'process', 'bytes', 'unknown')
    };
    scope.assert.partialDeepEqual(availableMemoryPercent(unconstrained), { availability: 'available', value: 10 });
}

function processSnapshot(value: number): ProcessWindow {
    const captured = readHostProcessWindow();
    return {
        ...captured,
        cpu: { ...captured.cpu, availability: 'available', value: { user: value, system: value * 2 } },
        memory: { ...captured.memory, availability: 'available', value: { ...process.memoryUsage(), rss: value } },
        resources: {
            ...captured.resources,
            availability: 'available',
            value: { ...process.resourceUsage(), fsRead: value * 3, maxRSS: value * 4 }
        }
    };
}

type ExpectedProcessMetric = {
    readonly name: string;
    readonly value: number;
    readonly unit: string;
    readonly source: string;
};
function assertProcessMetric(scope: TestScope, metrics: HostProcessMetrics, expected: ExpectedProcessMetric): void {
    const reading = metrics[expected.name];
    scope.require.defined(reading);
    scope.assert.partialDeepEqual(reading, {
        availability: 'available',
        value: expected.value,
        unit: expected.unit,
        scope: 'process',
        source: expected.source
    });
}

export const testNode = suite('benchmark host evidence', [
    test('records native process deltas, memory values, and resource units', function (scope: TestScope) {
        const metrics = hostProcessMetrics(processSnapshot(10), processSnapshot(20));
        assertProcessMetric(scope, metrics, {
            name: 'processCpuUserMicroseconds',
            value: 10,
            unit: 'microseconds',
            source: 'process.cpuUsage() delta'
        });
        assertProcessMetric(scope, metrics, {
            name: 'processCpuSystemMicroseconds',
            value: 20,
            unit: 'microseconds',
            source: 'process.cpuUsage() delta'
        });
        assertProcessMetric(scope, metrics, {
            name: 'processCpuTotalMicroseconds',
            value: 30,
            unit: 'microseconds',
            source: 'process.cpuUsage() delta'
        });
        assertProcessMetric(scope, metrics, {
            name: 'residentSetBytesDelta',
            value: 10,
            unit: 'bytes',
            source: 'process.memoryUsage() delta'
        });
        assertProcessMetric(scope, metrics, {
            name: 'fsReadDelta',
            value: 30,
            unit: 'count',
            source: 'process.resourceUsage() delta'
        });
        assertProcessMetric(scope, metrics, {
            name: 'processMaximumResidentSetBytes',
            value: 81_920,
            unit: 'bytes',
            source: 'process.resourceUsage().maxRSS'
        });
        return scope.assert.collect();
    }),
    test('rejects duplicate PSI fields and levels', function (scope: TestScope) {
        scope.assert.throws(function () {
            parseLinuxPressure(psi.replace('avg60=2.50', 'avg10=2.50'), 'psi');
        }, { name: 'TypeError' });
        scope.assert.throws(function () {
            parseLinuxPressure(psi + psi, 'psi');
        }, { name: 'TypeError' });
        return scope.assert.collect();
    }),
    test('derives percentages from capacity rather than absolute host sizes', function (scope: TestScope) {
        assertRelativeReadings(scope);
        const before = [ { model: 'cpu', speed: 1, times: { user: 10, sys: 0, nice: 0, idle: 20, irq: 0 } } ];
        const after = [ { model: 'cpu', speed: 1, times: { user: 20, sys: 0, nice: 0, idle: 50, irq: 0 } } ];
        scope.assert.partialDeepEqual(cpuBusyPercent(before, after), { availability: 'available', value: 25 });
        scope.assert.partialDeepEqual(cpuBusyPercent(before, before), { availability: 'unavailable' });
        scope.assert.partialDeepEqual(
            cpuBusyPercent(
                after,
                before.map(function resetCpu(cpu) {
                    return { ...cpu };
                })
            ),
            { availability: 'unavailable' }
        );
        scope.assert.partialDeepEqual(cpuBusyPercent(before, []), { availability: 'unavailable' });
        return scope.assert.collect();
    }),
    test('passes equality and blocks violated or unavailable configured signals', function (scope: TestScope) {
        const snapshot = benchmarkHostSnapshot();
        const limits = benchmarkHostLimitsSchema.parse({
            maximumCpuBusyPercent: 25,
            minimumAvailableMemoryPercent: 20
        });
        scope.assert.deepEqual(
            evaluateBenchmarkHost(snapshot, limits).checks.map(function (check) {
                return check.status;
            }),
            [
                'passed',
                'passed'
            ]
        );
        const missing = {
            ...snapshot,
            signals: {
                ...snapshot.signals,
                availableMemoryPercent: unavailableHostReading<number>('node', 'process', 'percent', 'denied')
            }
        };
        const strict = benchmarkHostLimitsSchema.parse({
            maximumCpuBusyPercent: 24,
            minimumAvailableMemoryPercent: 20
        });
        scope.assert.deepEqual(
            evaluateBenchmarkHost(missing, strict).checks.map(function (check) {
                return check.status;
            }),
            [
                'violated',
                'unavailable'
            ]
        );
        scope.assert.deepEqual(evaluateBenchmarkHost(missing, benchmarkHostLimitsSchema.parse({})).checks, []);
        return scope.assert.collect();
    }),
    test('parses native PSI percentages and rejects misleading data', function (scope: TestScope) {
        const readings = parseLinuxPressure(psi, '/proc/pressure/memory');
        scope.require.defined(readings['some.avg10']);
        scope.require.defined(readings['full.total']);
        scope.assert.partialDeepEqual(readings['some.avg10'], {
            availability: 'available',
            value: 1.25,
            unit: 'percent'
        });
        scope.assert.partialDeepEqual(readings['full.total'], {
            availability: 'available',
            value: 0,
            unit: 'microseconds'
        });
        for (
            const text of [
                '',
                psi.replace('1.25', '101'),
                psi.replace('1.25', 'NaN')
            ]
        ) {
            scope.assert.throws(function () {
                return parseLinuxPressure(text, 'psi');
            }, { name: 'ZodError' });
        }
        return scope.assert.collect();
    }),
    test('keeps absent Darwin CPU fields unavailable rather than assuming full capacity', function (scope: TestScope) {
        const readings = parseDarwinCpuLimits(
            'CPU_Speed_Limit = 80\nNote: No performance warning level has been recorded\n'
        );
        scope.require.defined(readings.CPU_Speed_Limit);
        scope.require.defined(readings.CPU_Scheduler_Limit);
        scope.assert.partialDeepEqual(readings.CPU_Speed_Limit, { availability: 'available', value: 80 });
        scope.assert.partialDeepEqual(readings.CPU_Scheduler_Limit, { availability: 'unavailable' });
        const invalid = parseDarwinCpuLimits('CPU_Speed_Limit = 101').CPU_Speed_Limit;
        scope.require.defined(invalid);
        scope.assert.partialDeepEqual(invalid, {
            availability: 'unavailable'
        });
        return scope.assert.collect();
    })
]);

const { runIfMain } = await import('#test-runner');
await runIfMain(import.meta, testNode);
