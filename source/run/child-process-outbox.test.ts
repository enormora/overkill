import { suite, test, testDouble } from '@overkill-dev/test';

import { createAsyncLeakMonitor } from '../engine/async-leak-diagnostics.ts';
import { createRoot, createTestPlan } from '../packages/engine/engine.entry-point.ts';

import { delayedOutbox } from '../test-support/child-process-outbox-fixture.ts';
import { createChildProcessOutbox, type SendChildProcessMessage } from './child-process-outbox.ts';
import { childProcessEnvelope } from './child-process-protocol.ts';

const metadata = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;
export const testNode = suite('source/run/child-process-outbox.test.ts', [
    test('pending IPC deliveries belong to runner infrastructure', async function (scope) {
        const monitor = createAsyncLeakMonitor();
        scope.cleanup(monitor.stop);
        const testCase = createTestPlan(createRoot({
            ...metadata,
            title: 'IPC observation',
            children: [ testNode ]
        }))
            .cases[0];
        const fixture = delayedOutbox([]);
        await monitor.runCase(testCase, async function queuePendingDelivery() {
            fixture.outbox.send('event');
            await scope.yieldToNextTurn();
        });
        const leak = monitor.casePromiseLeakError(testCase);
        fixture.complete('event', null);
        await fixture.outbox.disconnect();
        scope.assert.equal(leak, null);
        return scope.assert.collect();
    }),
    test('disconnect waits for every delivery even when callbacks finish out of order', async function (scope) {
        const fixture = delayedOutbox([ 'first', 'result' ]);
        const closed = fixture.outbox.disconnect();
        fixture.complete('result', null);
        await scope.yieldToNextTurn();
        scope.assert.false(fixture.disconnected());
        fixture.complete('first', null);
        await closed;
        scope.assert.true(fixture.disconnected());
        scope.assert.deepEqual(fixture.messages, [
            childProcessEnvelope('test', 'first'),
            childProcessEnvelope('test', 'result')
        ]);
        return scope.assert.collect();
    }),
    test('disconnect also drains messages sent while an earlier delivery is pending', async function (scope) {
        const fixture = delayedOutbox([ 'first' ]);
        const closed = fixture.outbox.disconnect();
        fixture.outbox.send('last');
        fixture.complete('first', null);
        await scope.yieldToNextTurn();
        scope.assert.false(fixture.disconnected());
        fixture.complete('last', null);
        await closed;
        scope.assert.true(fixture.disconnected());
        return scope.assert.collect();
    }),
    test('delivery failures surface after remaining messages drain and the channel closes', async function (scope) {
        const fixture = delayedOutbox([ 'failed', 'last' ]);
        fixture.complete('failed', new Error('Delivery failed.'));
        const closed = fixture.outbox.disconnect();
        fixture.complete('last', null);
        await scope.assert.rejects(async function disconnect() {
            await closed;
        }, { message: 'Delivery failed.' });
        scope.assert.true(fixture.disconnected());
        return scope.assert.collect();
    }),
    test('synchronous send failures close the channel and reject', async function (scope) {
        let disconnected = false;
        const outbox = createChildProcessOutbox('test', {
            disconnect() {
                disconnected = true;
            },
            send() {
                throw new Error('Send failed.');
            }
        });
        outbox.send('result');
        await scope.assert.rejects(outbox.disconnect, {
            message: 'Send failed.'
        });
        scope.assert.true(disconnected);
        return scope.assert.collect();
    }),
    test('non-Error send failures retain their cause in a delivery error', async function (scope) {
        const outbox = createChildProcessOutbox('test', {
            disconnect: null,
            send: testDouble.throws<SendChildProcessMessage>('send failed')
        });
        outbox.send('result');
        await scope.assert.rejects(outbox.disconnect, {
            cause: { exact: 'send failed' },
            message: 'Child IPC send failed.'
        });
        return scope.assert.collect();
    }),
    test('execution without an IPC channel completes without pending deliveries', async function (scope) {
        let disconnected = false;
        const outbox = createChildProcessOutbox('test', {
            disconnect() {
                disconnected = true;
            },
            send: null
        });
        outbox.send('result');
        await outbox.disconnect();
        scope.assert.true(disconnected);
        return scope.assert.collect();
    })
]);
