import { setImmediate as yieldToNextTurn } from 'node:timers/promises';
import { createSuite, createTestCase } from '../packages/engine/engine.entry-point.ts';
import { testDouble } from '../packages/doubles/doubles.entry-point.ts';
import {
    createChildProcessOutbox,
    type ChildProcessOutbox,
    type SendChildProcessMessage
} from './child-process-outbox.ts';
import { childProcessEnvelope, type ChildProcessEnvelope } from './child-process-protocol.ts';

const metadata = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;
type OutboxFixture = {
    readonly outbox: ChildProcessOutbox;
    readonly complete: (message: unknown, error: Error | null) => void;
    readonly disconnected: () => boolean;
    readonly messages: readonly ChildProcessEnvelope<unknown>[];
};

function delayedOutbox(queued: readonly string[]): OutboxFixture {
    const messages: ChildProcessEnvelope<unknown>[] = [];
    const deliveries = new Map<unknown, (error: Error | null) => void>();
    let disconnected = false;

    const fixture: OutboxFixture = {
        outbox: createChildProcessOutbox('test', {
            disconnect() {
                disconnected = true;
            },
            send(message, complete) {
                messages.push(message);
                deliveries.set(message.message, complete);
                return false;
            }
        }),
        complete(message, error) {
            const complete = deliveries.get(message);
            if (complete === undefined) {
                throw new Error('Message was not sent.');
            }
            complete(error);
        },
        disconnected() {
            return disconnected;
        },
        messages
    };
    queued.forEach(fixture.outbox.send);
    return fixture;
}

export const testNode = createSuite({
    ...metadata,
    title: 'source/run/child-process-outbox.test.ts',
    children: [
        createTestCase({
            ...metadata,
            title: 'disconnect waits for every delivery even when callbacks finish out of order',
            async body(scope) {
                const fixture = delayedOutbox([ 'first', 'result' ]);
                const closed = fixture.outbox.disconnect();
                fixture.complete('result', null);
                await yieldToNextTurn();
                scope.assert.false(fixture.disconnected());
                fixture.complete('first', null);
                await closed;
                scope.assert.true(fixture.disconnected());
                scope.assert.deepEqual(fixture.messages, [
                    childProcessEnvelope('test', 'first'),
                    childProcessEnvelope('test', 'result')
                ]);
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...metadata,
            title: 'disconnect also drains messages sent while an earlier delivery is pending',
            async body(scope) {
                const fixture = delayedOutbox([ 'first' ]);
                const closed = fixture.outbox.disconnect();
                fixture.outbox.send('last');
                fixture.complete('first', null);
                await yieldToNextTurn();
                scope.assert.false(fixture.disconnected());
                fixture.complete('last', null);
                await closed;
                scope.assert.true(fixture.disconnected());
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...metadata,
            title: 'delivery failures surface after remaining messages drain and the channel closes',
            async body(scope) {
                const fixture = delayedOutbox([ 'failed', 'last' ]);
                fixture.complete('failed', new Error('Delivery failed.'));
                const closed = fixture.outbox.disconnect();
                fixture.complete('last', null);
                await scope.assert.rejects(async function disconnect() {
                    await closed;
                }, { message: 'Delivery failed.' });
                scope.assert.true(fixture.disconnected());
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...metadata,
            title: 'synchronous send failures close the channel and reject',
            async body(scope) {
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
            }
        }),
        createTestCase({
            ...metadata,
            title: 'non-Error send failures retain their cause in a delivery error',
            async body(scope) {
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
            }
        }),
        createTestCase({
            ...metadata,
            title: 'execution without an IPC channel completes without pending deliveries',
            async body(scope) {
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
            }
        })
    ]
});

const { runIfMain } = await import('../test-support/run-if-main.ts');

await runIfMain(import.meta, testNode);
