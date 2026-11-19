import { setImmediate as nextTurn } from 'node:timers/promises';
import { suite as authoredSuite, test } from '@overkill-dev/test';
import { prepareAsyncTestCollector, prepareTestCollector } from '../test-support/collector-session.ts';

import { processResourceCollector } from './native-metric-collectors.ts';
import { runtimeHealthCollector } from './runtime-health-collector.ts';
import type { MetricReadings } from './measurement-types.ts';

function blockRuntime(milliseconds: number): void {
    const until = performance.now() + milliseconds;
    let current = performance.now();
    while (current < until) {
        current = performance.now();
    }
}

function loopReadings(readings: MetricReadings): MetricReadings {
    return Object.fromEntries(
        Object.entries(readings).filter(function loopReading([ name ]) {
            return name.startsWith('eventLoopDelay');
        })
    );
}

async function stoppedSession(signal: AbortSignal): Promise<Awaited<ReturnType<typeof prepareAsyncTestCollector>>> {
    const session = await prepareAsyncTestCollector(runtimeHealthCollector(), signal);
    await session.start();
    await nextTurn();
    await nextTurn();
    await session.stop();
    return session;
}

export const testNode = authoredSuite('runtime health boundaries', [
    test('freezes loop delay before draining and collector completion work', async function (scope) {
        const session = await stoppedSession(scope.signal);
        await using disposal = new AsyncDisposableStack();
        disposal.defer(session.dispose);
        const before = await session.complete();
        blockRuntime(50);
        await nextTurn();
        const after = await session.complete();
        scope.assert.equal(before.eventLoopDelayMaximumMicroseconds?.availability, 'available');
        scope.assert.deepEqual(loopReadings(after), loopReadings(before));
        return scope.assert.collect();
    }),
    test('does not invent loop observations while draining a synchronous region', async function (scope) {
        const session = await prepareAsyncTestCollector(runtimeHealthCollector(), scope.signal);
        await using disposal = new AsyncDisposableStack();
        disposal.defer(session.dispose);
        await session.start();
        await session.stop();
        const readings = await session.complete();
        scope.assert.equal(readings.eventLoopDelayMaximumMicroseconds?.availability, 'unavailable');
        return scope.assert.collect();
    }),
    test('requires both process resource snapshots before reporting counters', function (scope) {
        for (const boundary of [ 'none', 'start', 'stop' ]) {
            const session = prepareTestCollector(processResourceCollector(), scope.signal);
            if (boundary === 'start') {
                session.start();
            } else if (boundary === 'stop') {
                session.stop();
            }
            scope.assert.throws(function () {
                return session.complete();
            }, { message: 'Resource measurement requires start and stop.' });
            session.dispose();
        }
        return scope.assert.collect();
    })
]);
