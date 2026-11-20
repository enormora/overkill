import { type TestNode, suite, test } from '@overkill-dev/test';

import { nodeChildObservation } from '../test-support/node-child-observation.ts';

export const testNode: TestNode = suite('child runtime metric ownership', [
    test('converts process readings and retains metric provenance', function (scope) {
        const fixture = nodeChildObservation(2);
        const report = fixture.observation.snapshot();
        fixture.observation.dispose();
        scope.assert.equal(report.runtime, 'unit-runtime');
        scope.assert.equal(report.observationMicroseconds, 5);
        scope.assert.partialDeepEqual(report.metrics, {
            processCpuUserMicroseconds: {
                availability: 'available',
                value: 100,
                provenance: { scope: 'process', unit: 'microseconds' }
            },
            processCpuSystemMicroseconds: { value: 50 },
            processCpuTotalMicroseconds: { value: 150 },
            residentSetBytes: { value: 4096, provenance: { scope: 'process' } },
            heapUsedBytes: { value: 2048, provenance: { scope: 'thread' } },
            processMaximumResidentSetBytes: { value: 8192, provenance: { unit: 'bytes' } },
            eventLoopDelayMeanMicroseconds: { value: 2, provenance: { scope: 'runtime', unit: 'microseconds' } },
            eventLoopDelayMaximumMicroseconds: { value: 9 },
            eventLoopDelayPercentile95Microseconds: { value: 7 },
            eventLoopUtilization: { value: 0.75, provenance: { scope: 'thread', unit: 'ratio' } }
        });
        scope.assert.deepEqual(fixture.calls, [
            'utilization:start',
            'enable',
            'percentile:95',
            'utilization:elapsed',
            'disable'
        ]);
        return scope.assert.collect();
    }),
    test('marks delay metrics unavailable until samples arrive', function (scope) {
        const fixture = nodeChildObservation(0);
        const report = fixture.observation.snapshot();
        fixture.observation.dispose();
        scope.assert.partialDeepEqual(report.metrics, {
            eventLoopDelayMeanMicroseconds: {
                availability: 'unavailable',
                reason: 'No event-loop observations were collected.'
            },
            eventLoopDelayMaximumMicroseconds: { availability: 'unavailable' },
            eventLoopDelayPercentile95Microseconds: { availability: 'unavailable' },
            eventLoopUtilization: { availability: 'available', value: 0.75 }
        });
        return scope.assert.collect();
    })
]);
