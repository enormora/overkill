import { setImmediate as nextTurn } from 'node:timers/promises';
import { suite, test } from '../packages/test/test.entry-point.ts';
import { runtimeHealthCollector } from './runtime-health-collector.ts';
import type { AsyncCollectorSession, MetricReadings } from './measurement-types.ts';

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

async function stoppedSession(signal: AbortSignal): Promise<AsyncCollectorSession> {
    const session = await runtimeHealthCollector().prepare(signal);
    session.start();
    await nextTurn();
    await nextTurn();
    session.stop();
    return session;
}

export const testNode = suite('runtime health boundaries', [
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
        const session = await runtimeHealthCollector().prepare(scope.signal);
        await using disposal = new AsyncDisposableStack();
        disposal.defer(session.dispose);
        session.start();
        session.stop();
        const readings = await session.complete();
        scope.assert.equal(readings.eventLoopDelayMaximumMicroseconds?.availability, 'unavailable');
        return scope.assert.collect();
    })
]);
