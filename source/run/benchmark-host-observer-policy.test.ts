import { suite, test } from '@overkill-dev/test';

import { hostObservation, hostObservationScenario } from '../test-support/host-observation.ts';
import { observeBenchmarkHost } from './benchmark-host-observer.ts';

export const testNode = suite('benchmark host observation ownership', [
    test(
        'samples one bounded window and filters garbage collection entries by time',
        async function (scope) {
            const fixture = hostObservation(hostObservationScenario);
            const result = await observeBenchmarkHost(AbortSignal.any([]), fixture.runtime);
            scope.assert.partialDeepEqual<unknown, unknown>(result.cpuBusy, { availability: 'available', value: 75 });
            scope.assert.partialDeepEqual<unknown, unknown>(result.metrics.gcObservedCount, {
                availability: 'available',
                value: 2
            });
            scope.assert.partialDeepEqual<unknown, unknown>(result.metrics.gcObservedDurationMicroseconds, {
                availability: 'available',
                value: 3000
            });
            scope.assert.partialDeepEqual<unknown, unknown>(result.metrics.eventLoopDelayMeanMicroseconds, {
                availability: 'available',
                value: 2
            });
            scope.assert.partialDeepEqual<unknown, unknown>(result.metrics.eventLoopDelayMaximumMicroseconds, {
                availability: 'available',
                value: 5
            });
            scope.assert.partialDeepEqual<unknown, unknown>(result.metrics.eventLoopUtilization, {
                availability: 'available',
                value: 0.75
            });
            scope.assert.deepEqual(fixture.events, [
                'observe',
                'enable',
                'wait:250',
                'settle',
                'settle',
                'disable',
                'disconnect'
            ]);
            return scope.assert.collect();
        }
    ),
    test('marks unsampled event loop delays unavailable', async function (scope) {
        const fixture = hostObservation({ ...hostObservationScenario, count: 0 });
        const result = await observeBenchmarkHost(AbortSignal.any([]), fixture.runtime);
        scope.assert.partialDeepEqual<unknown, unknown>(result.metrics.eventLoopDelayMeanMicroseconds, {
            availability: 'unavailable',
            reason: 'No event-loop observations were collected.'
        });
        scope.assert.partialDeepEqual<unknown, unknown>(result.metrics.eventLoopDelayMaximumMicroseconds, {
            availability: 'unavailable'
        });
        return scope.assert.collect();
    }),
    test('reports unavailable CPU evidence when native CPU snapshots are absent', async function (scope) {
        const fixture = hostObservation({ ...hostObservationScenario, cpuAvailable: false });
        const result = await observeBenchmarkHost(AbortSignal.any([]), fixture.runtime);
        scope.assert.partialDeepEqual<unknown, unknown>(result.cpuBusy, {
            availability: 'unavailable',
            reason: 'CPU observation window is incomplete.'
        });
        return scope.assert.collect();
    }),
    test('releases observers after waiting fails and retains the reason', async function (scope) {
        const fixture = hostObservation({ ...hostObservationScenario, waitFailure: new Error('Wait failed.') });
        const result = await observeBenchmarkHost(AbortSignal.any([]), fixture.runtime);
        scope.assert.partialDeepEqual<unknown, unknown>(result.metrics.observation, {
            availability: 'unavailable',
            reason: 'Wait failed.'
        });
        scope.assert.partialDeepEqual<unknown, unknown>(result.cpuBusy, { availability: 'unavailable' });
        scope.assert.deepEqual(fixture.events, [ 'observe', 'enable', 'wait:250', 'disable', 'disconnect' ]);
        return scope.assert.collect();
    }),
    test('normalizes nonerror observation failures', async function (scope) {
        const fixture = hostObservation({ ...hostObservationScenario, waitFailure: 'unavailable' });
        const result = await observeBenchmarkHost(AbortSignal.any([]), fixture.runtime);
        scope.assert.partialDeepEqual<unknown, unknown>(result.metrics.observation, {
            availability: 'unavailable',
            reason: 'unavailable'
        });
        return scope.assert.collect();
    }),
    test('cleans up partially initialized observation windows', async function (scope) {
        const fixture = hostObservation({ ...hostObservationScenario, beginFailure: new Error('Cannot observe.') });
        const result = await observeBenchmarkHost(AbortSignal.any([]), fixture.runtime);
        scope.assert.partialDeepEqual<unknown, unknown>(result.metrics.observation, {
            availability: 'unavailable',
            reason: 'Cannot observe.'
        });
        scope.assert.deepEqual(fixture.events, [ 'observe', 'disable', 'disconnect' ]);
        return scope.assert.collect();
    }),
    test(
        'preserves cleanup failure as a collection error and still disconnects observers',
        async function (scope) {
            const failure = new Error('Cannot disable.');
            const fixture = hostObservation({ ...hostObservationScenario, cleanupFailure: failure });
            await scope.assert.rejects(async function () {
                return observeBenchmarkHost(AbortSignal.any([]), fixture.runtime);
            }, {
                message: 'Benchmark host observer cleanup failed.',
                cause: { exact: failure }
            });
            scope.assert.deepEqual(fixture.events.slice(-2), [ 'disable', 'disconnect' ]);
            return scope.assert.collect();
        }
    )
]);
