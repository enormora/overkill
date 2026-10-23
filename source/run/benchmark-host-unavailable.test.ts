import os from 'node:os';
import { mock } from 'node:test';
import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import type { HostReading } from '../bench/benchmark-host-snapshot.ts';
import { benchmarkHostSnapshot } from '../test-support/benchmark-host-snapshot.ts';
import {
    availableMemoryPercent,
    cpuBusyPercent,
    hostLoadPerCpuPercent,
    readBenchmarkHostCapacity
} from './benchmark-host-capacity.ts';
import { hostNumber, hostPercentage, observeHost, observerMetric } from './benchmark-host-reading.ts';
import { hostProcessMetrics, readHostProcessWindow } from './benchmark-host-process.ts';
import { parseLinuxPressure } from './benchmark-host-platform.ts';

function invalidNativeCapacity(): ReturnType<typeof readBenchmarkHostCapacity> {
    const cpu = mock.method(os, 'cpus', function () {
        return [];
    });
    const memory = mock.method(os, 'totalmem', function () {
        return 0;
    });
    const load = mock.method(os, 'loadavg', function () {
        return [ Number.NaN, 0, 0 ];
    });
    const constraint = mock.method(process, 'constrainedMemory', function () {
        return 0;
    });
    try {
        return readBenchmarkHostCapacity();
    } finally {
        cpu.mock.restore();
        memory.mock.restore();
        load.mock.restore();
        constraint.mock.restore();
    }
}

type WindowsHostEvidence = {
    readonly capacity: ReturnType<typeof readBenchmarkHostCapacity>;
    readonly metrics: ReturnType<typeof hostProcessMetrics>;
};

function windowsHostEvidence(): WindowsHostEvidence {
    const platform = mock.property(process, 'platform', 'win32');
    try {
        return {
            capacity: readBenchmarkHostCapacity(),
            metrics: hostProcessMetrics(readHostProcessWindow(), readHostProcessWindow())
        };
    } finally {
        platform.mock.restore();
    }
}

function reading(value: number): HostReading<number> {
    return hostNumber('capacity', 'host', 'bytes', function capacity() {
        return value;
    });
}

function unavailable(reason: string): HostReading<never> {
    return observeHost<never>('native', 'process', 'bytes', function denied() {
        throw new Error(reason);
    });
}

export const testNode = suite('unavailable benchmark host evidence', [
    test('marks unsupported Windows load and resource counters unavailable', function (scope: TestScope) {
        const { capacity, metrics } = windowsHostEvidence();
        scope.assert.partialDeepEqual(capacity.loadAverage, {
            availability: 'unavailable',
            reason: 'Load average is unsupported on Windows.'
        });
        scope.assert.partialDeepEqual(metrics, {
            majorPageFaultDelta: { availability: 'unavailable', reason: 'Counter unavailable on this platform.' },
            voluntaryContextSwitchesDelta: { availability: 'unavailable' },
            involuntaryContextSwitchesDelta: { availability: 'unavailable' },
            fsReadDelta: { availability: 'available' }
        });
        return scope.assert.collect();
    }),
    test('records zero native capacity and invalid load as unavailable', function (scope: TestScope) {
        const capacity = invalidNativeCapacity();
        scope.assert.partialDeepEqual(capacity, {
            logicalCpuCount: { availability: 'unavailable', reason: 'Logical CPU count is unavailable.' },
            cpuModels: { availability: 'available', value: [] },
            totalMemoryBytes: { availability: 'unavailable', reason: 'Physical memory capacity is unavailable.' },
            loadAverage: { availability: 'unavailable', reason: 'Load averages are unavailable.' },
            constrainedMemoryBytes: {
                availability: 'unavailable',
                reason: 'Memory constraint is unknown or not imposed.'
            }
        });
        return scope.assert.collect();
    }),
    test('rejects pressure data missing the partial-stall level', function (scope: TestScope) {
        scope.assert.throws(function () {
            parseLinuxPressure('full avg10=0 avg60=0 avg300=0 total=0', 'psi');
        }, { name: 'TypeError', message: 'Missing or duplicate PSI pressure level.' });
        return scope.assert.collect();
    }),
    test('retains native errors and rejects nonfinite and negative readings', function (scope: TestScope) {
        scope.assert.partialDeepEqual(unavailable('denied'), { availability: 'unavailable', reason: 'denied' });
        for (const value of [ Number.NaN, Number.POSITIVE_INFINITY, -1 ]) {
            scope.assert.partialDeepEqual(reading(value), { availability: 'unavailable' });
        }
        scope.assert.partialDeepEqual(reading(0), { availability: 'available', value: 0 });
        return scope.assert.collect();
    }),
    test('propagates unavailable ratio operands and rejects zero capacity', function (scope: TestScope) {
        scope.assert.partialDeepEqual(hostPercentage('ratio', 'host', unavailable('numerator'), reading(10)), {
            availability: 'unavailable',
            reason: 'numerator'
        });
        scope.assert.partialDeepEqual(hostPercentage('ratio', 'host', reading(1), unavailable('denominator')), {
            availability: 'unavailable',
            reason: 'denominator'
        });
        scope.assert.partialDeepEqual(hostPercentage('ratio', 'host', reading(1), reading(0)), {
            availability: 'unavailable',
            reason: 'Host capacity denominator must be positive.'
        });
        return scope.assert.collect();
    }),
    test('rejects memory above capacity and preserves missing load and capacity', function (scope: TestScope) {
        const { capacity } = benchmarkHostSnapshot();
        scope.assert.partialDeepEqual(availableMemoryPercent({ ...capacity, availableMemoryBytes: reading(10_000) }), {
            availability: 'unavailable',
            reason: 'Available memory exceeds known capacity.'
        });
        scope.assert.partialDeepEqual(
            availableMemoryPercent({ ...capacity, totalMemoryBytes: unavailable('physical') }),
            {
                availability: 'unavailable',
                reason: 'physical'
            }
        );
        scope.assert.partialDeepEqual(
            availableMemoryPercent({ ...capacity, availableMemoryBytes: unavailable('memory') }),
            {
                availability: 'unavailable',
                reason: 'memory'
            }
        );
        scope.assert.partialDeepEqual(hostLoadPerCpuPercent({ ...capacity, loadAverage: unavailable('load') }), {
            availability: 'unavailable',
            reason: 'load'
        });
        scope.assert.partialDeepEqual(hostLoadPerCpuPercent({ ...capacity, logicalCpuCount: unavailable('cpus') }), {
            availability: 'unavailable',
            reason: 'cpus'
        });
        return scope.assert.collect();
    }),
    test('rejects changed CPU identity and nonfinite CPU counters', function (scope: TestScope) {
        const cpu = { model: 'cpu', speed: 1, times: { user: 10, sys: 0, nice: 0, idle: 20, irq: 0 } };
        scope.assert.partialDeepEqual(cpuBusyPercent([ cpu ], [ { ...cpu, model: 'replacement' } ]), {
            availability: 'unavailable',
            reason: 'CPU set changed during observation.'
        });
        scope.assert.partialDeepEqual(
            cpuBusyPercent([ cpu ], [ { ...cpu, times: { ...cpu.times, user: Number.NaN } } ]),
            {
                availability: 'unavailable',
                reason: 'CPU counter reset during observation.'
            }
        );
        return scope.assert.collect();
    }),
    test('propagates unavailable native process windows', function (scope: TestScope) {
        const before = readHostProcessWindow();
        const after = {
            ...before,
            cpu: unavailable('cpu denied'),
            memory: unavailable('memory denied'),
            resources: unavailable('resources denied'),
            activeResourceCount: unavailable('resources denied')
        };
        const metrics = hostProcessMetrics(before, after);
        scope.assert.partialDeepEqual(metrics, {
            processCpuTotalMicroseconds: { availability: 'unavailable', reason: 'cpu denied' },
            heapUsedBytes: { availability: 'unavailable', reason: 'memory denied', scope: 'thread' },
            fsWriteDelta: { availability: 'unavailable', reason: 'resources denied' },
            activeResourceCountDelta: { availability: 'unavailable' }
        });
        return scope.assert.collect();
    }),
    test('retains signed deltas but rejects nonfinite native observations', function (scope: TestScope) {
        const signed = {
            source: 'delta',
            scope: 'process' as const,
            unit: 'bytes',
            availability: 'available' as const,
            value: -1
        };
        scope.assert.partialDeepEqual(observerMetric(signed, 'thread'), { availability: 'available', value: -1 });
        scope.assert.partialDeepEqual(observerMetric({ ...signed, value: Number.NaN }, 'thread'), {
            availability: 'unavailable',
            reason: 'Native observation is not finite.'
        });
        return scope.assert.collect();
    })
]);

await runIfMain(import.meta, testNode);
