import { createTestCase } from '../packages/engine/engine.entry-point.ts';
import { settleAsyncWork } from '../engine/async-control.ts';
import { createReportingContext } from '../engine/reporting-context.ts';
import { delayedOutbox, type OutboxFixture } from '../test-support/child-process-outbox-fixture.ts';
import { createSupervisedChildReporter } from './supervised-child-execution.ts';

async function drainQueuedMessages(fixture: OutboxFixture): Promise<boolean> {
    const closed = fixture.outbox.disconnect();
    const disconnectedBeforeFlush = fixture.disconnected();
    for (const message of fixture.messages) {
        fixture.complete(message.message, null);
    }
    await closed;
    return disconnectedBeforeFlush;
}

async function reportThroughPendingTransport(): Promise<{
    readonly beforeFlush: unknown;
    readonly disconnectedBeforeFlush: boolean;
    readonly disconnected: boolean;
    readonly sent: OutboxFixture['messages'];
}> {
    const fixture = delayedOutbox([]);
    const reporter = createSupervisedChildReporter(fixture.outbox)(createReportingContext({ projectRoot: null }));
    if (reporter.kind !== 'real-time') {
        throw new Error('Expected a real-time child reporter.');
    }
    const pending = Promise.resolve(reporter.onEvent({ kind: 'suite-start', suitePath: [] }));
    await settleAsyncWork();
    const beforeFlush = await Promise.race([ pending, Promise.resolve('pending') ]);
    const disconnectedBeforeFlush = await drainQueuedMessages(fixture);
    await pending;
    return { beforeFlush, disconnected: fixture.disconnected(), disconnectedBeforeFlush, sent: fixture.messages };
}

export const testNode = createTestCase({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'supervised reporting queues events before draining IPC on disconnect',
    async body(scope) {
        const result = await reportThroughPendingTransport();
        scope.assert.equal(result.beforeFlush, undefined);
        scope.assert.equal(result.disconnectedBeforeFlush, false);
        scope.assert.equal(result.disconnected, true);
        scope.assert.partialDeepEqual(result.sent, [ {
            message: { kind: 'event', event: { kind: 'suite-start', suitePath: [] } }
        } ]);
        return scope.assert.collect();
    }
});

const { runIfMain } = await import('../test-support/run-if-main.ts');
await runIfMain(import.meta, testNode);
