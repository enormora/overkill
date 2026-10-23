import { createTestCase } from '../packages/engine/engine.entry-point.ts';
import { createReportingContext } from '../engine/reporting-context.ts';
import { createSupervisedChildReporter } from './supervised-child-execution.ts';
import type { SupervisedChildMessage } from './supervised-protocol.ts';

async function reportThroughPendingTransport(): Promise<{
    readonly beforeFlush: unknown;
    readonly sent: readonly SupervisedChildMessage[];
}> {
    const flushed = Promise.withResolvers<undefined>();
    const sent: SupervisedChildMessage[] = [];
    const reporter = createSupervisedChildReporter({
        send(message) {
            sent.push(message);
        },
        async flush() {
            return flushed.promise;
        }
    })(createReportingContext({ projectRoot: null }));
    if (reporter.kind !== 'real-time') {
        throw new Error('Expected a real-time child reporter.');
    }
    const pending = Promise.resolve(reporter.onEvent({ kind: 'suite-start', suitePath: [] }));
    const beforeFlush = await Promise.race([ pending, Promise.resolve('pending') ]);
    flushed.resolve(undefined);
    await pending;
    return { beforeFlush, sent };
}

export const testNode = createTestCase({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'supervised reporting waits for IPC delivery before completing an event',
    async body(scope) {
        const result = await reportThroughPendingTransport();
        scope.assert.equal(result.beforeFlush, 'pending');
        scope.assert.deepEqual(result.sent, [ { kind: 'event', event: { kind: 'suite-start', suitePath: [] } } ]);
        return scope.assert.collect();
    }
});

const { runIfMain } = await import('#test-runner');
await runIfMain(import.meta, testNode);
