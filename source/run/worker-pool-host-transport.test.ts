import { EventEmitter } from 'node:events';
import { runInNewContext } from 'node:vm';
import { createSuite, createTestCase } from '../packages/engine/engine.entry-point.ts';
import { observeHostTransport } from './worker-pool-host-transport.ts';
import type { SupervisedChildProcess } from './supervised-child-process.ts';
import { childProcessEnvelope } from './child-process-protocol.ts';
import type { WorkerPoolHostMessage } from './worker-pool-host-protocol.ts';

const metadata = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;
type HostFixture = {
    readonly errors: readonly Error[];
    readonly messages: readonly WorkerPoolHostMessage[];
    readonly emit: (event: string, value: unknown) => void;
    readonly finished: () => number;
};
function hostFixture(deliveryFailure: Error | null): HostFixture {
    const events = new EventEmitter();
    const errors: Error[] = [];
    const messages: WorkerPoolHostMessage[] = [];
    let finished = 0;
    const child: SupervisedChildProcess = {
        closeTransport() {
            return undefined;
        },
        exitCode: 0,
        signalCode: null,
        pid: 1,
        kill() {
            return undefined;
        },
        on(...registration) {
            const [ event, listener ] = registration;
            events.on(event, listener);
        },
        send() {
            return undefined;
        },
        stderr: null,
        stdout: null
    };
    observeHostTransport({
        child,
        configured() {
            return undefined;
        },
        failed(error) {
            errors.push(error);
        },
        finished() {
            finished += 1;
        },
        hasTask(taskId) {
            return taskId === 'known';
        },
        receive(message) {
            if (deliveryFailure !== null) {
                throw deliveryFailure;
            }
            messages.push(message);
        }
    });
    return {
        errors,
        messages,
        emit(event, value) {
            events.emit(event, value);
        },
        finished() {
            return finished;
        }
    };
}
const invalidMessages: readonly unknown[] = [
    childProcessEnvelope('worker-pool-host', { kind: 'task-result', taskId: 'known', result: null }),
    childProcessEnvelope('worker-pool-host', {
        kind: 'task-message',
        taskId: 'known',
        message: { kind: 'output', stream: 'stdout', capturedAtMicroseconds: 0, chunkBase64: '%' }
    }),
    childProcessEnvelope('worker-pool-host', { kind: 'runner-error', error: { message: 'incomplete' } })
];
function createForeignDeliveryError(): Error {
    return runInNewContext('new Error("Delivery failed.")') as Error;
}
export const testNode = createSuite({
    title: 'worker pool host transport',
    ...metadata,
    children: [
        ...[ new Error('Delivery failed.'), createForeignDeliveryError() ].map(function deliveryFailure(failure) {
            return createTestCase({
                title: `delivery failure from ${
                    failure instanceof Error ? 'native' : 'foreign'
                } errors settles the host transport`,
                ...metadata,
                body(scope) {
                    const fixture = hostFixture(failure);
                    fixture.emit('message', childProcessEnvelope('worker-pool-host', { kind: 'configured' }));
                    fixture.emit(
                        'message',
                        childProcessEnvelope('worker-pool-host', { kind: 'task-result', taskId: 'known', result: null })
                    );
                    fixture.emit('close', undefined);
                    scope.assert.equal(fixture.errors.length, 1);
                    scope.assert.equal(
                        fixture.errors[0]?.message,
                        failure instanceof Error ? failure.message : 'Invalid hosted worker-pool IPC payload.'
                    );
                    scope.assert.deepEqual(fixture.messages, []);
                    scope.assert.equal(fixture.finished(), 1);
                    return scope.assert.collect();
                }
            });
        }),
        ...invalidMessages.map(function invalidMessage(message, index) {
            return createTestCase({
                title: `invalid host message ${index} fails before forwarding`,
                ...metadata,
                body(scope) {
                    const fixture = hostFixture(null);
                    fixture.emit('message', message);
                    fixture.emit('message', message);
                    fixture.emit('close', undefined);
                    scope.assert.equal(fixture.errors.length, 1);
                    scope.assert.deepEqual(fixture.messages, []);
                    scope.assert.equal(fixture.finished(), 1);
                    return scope.assert.collect();
                }
            });
        }),
        createTestCase({
            title: 'duplicate configuration acknowledgements fail the host lifecycle',
            ...metadata,
            body(scope) {
                const fixture = hostFixture(null);
                fixture.emit('message', childProcessEnvelope('worker-pool-host', { kind: 'configured' }));
                fixture.emit('message', childProcessEnvelope('worker-pool-host', { kind: 'configured' }));
                fixture.emit('close', undefined);
                scope.assert.equal(fixture.errors[0]?.message, 'Invalid hosted worker-pool IPC lifecycle.');
                return scope.assert.collect();
            }
        }),
        createTestCase({
            title: 'ordinary task results preserve host reuse until destruction acknowledgement',
            ...metadata,
            body(scope) {
                const fixture = hostFixture(null);
                fixture.emit('message', childProcessEnvelope('worker-pool-host', { kind: 'configured' }));
                fixture.emit(
                    'message',
                    childProcessEnvelope('worker-pool-host', {
                        kind: 'task-result',
                        taskId: 'known',
                        result: { opaque: true }
                    })
                );
                scope.assert.equal(fixture.finished(), 0);
                fixture.emit('message', childProcessEnvelope('worker-pool-host', { kind: 'destroyed' }));
                fixture.emit('disconnect', undefined);
                fixture.emit('close', undefined);
                scope.assert.deepEqual(fixture.errors, []);
                scope.assert.equal(fixture.finished(), 1);
                return scope.assert.collect();
            }
        }),
        createTestCase({
            title: 'a host disconnect without destruction acknowledgement fails and still drains',
            ...metadata,
            body(scope) {
                const fixture = hostFixture(null);
                fixture.emit('disconnect', undefined);
                scope.assert.equal(fixture.finished(), 0);
                fixture.emit('close', undefined);
                scope.assert.equal(
                    fixture.errors[0]?.message,
                    'Hosted worker-pool disconnected before destruction acknowledgement.'
                );
                scope.assert.equal(fixture.finished(), 1);
                return scope.assert.collect();
            }
        }),
        createTestCase({
            title: 'a foreign envelope cannot configure a host or turn an incomplete close into success',
            ...metadata,
            body(scope) {
                const fixture = hostFixture(null);
                fixture.emit('message', childProcessEnvelope('other-role', { kind: 'configured' }));
                fixture.emit('close', undefined);
                scope.assert.equal(fixture.errors[0]?.message, 'Hosted worker-pool exited before successful shutdown.');
                return scope.assert.collect();
            }
        }),
        createTestCase({
            title: 'messages after destruction acknowledgement fail before closure',
            ...metadata,
            body(scope) {
                const fixture = hostFixture(null);
                fixture.emit('message', childProcessEnvelope('worker-pool-host', { kind: 'destroyed' }));
                fixture.emit('message', childProcessEnvelope('worker-pool-host', { kind: 'configured' }));
                fixture.emit('close', undefined);
                scope.assert.equal(fixture.errors[0]?.message, 'Invalid hosted worker-pool IPC lifecycle.');
                return scope.assert.collect();
            }
        })
    ]
});
const { runIfMain } = await import('../test-support/run-if-main.ts');
await runIfMain(import.meta, testNode);
