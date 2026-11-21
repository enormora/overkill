import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { suite, test } from '@overkill-dev/test';

import { z } from 'zod/v4';

import { childProcessEnvelope, envelopeMessage } from './child-process-protocol.ts';
import { childRoleArgument, workerPoolHostRole } from './child-process-roles.ts';
import type { SupervisedChildProcess } from './supervised-child-process.ts';
import { createWorkerPoolMessageChannel, type WorkerPoolMessage } from './worker-pool-protocol.ts';
import {
    deserializeError,
    deserializeWorkerPoolMessage,
    type SerializedError,
    serializeError,
    serializeWorkerPoolMessage
} from './worker-pool-host-protocol.ts';
import { createWorkerPoolHostProcessStarter } from './worker-pool-host-process-starter.ts';

function createChildProcess(): SupervisedChildProcess {
    return {
        closeTransport() {
            return undefined;
        },
        exitCode: null,
        kill() {
            return true;
        },
        on() {
            return undefined;
        },
        pid: 12,
        send() {
            return true;
        },
        signalCode: null,
        stderr: null,
        stdout: null
    };
}

type ProtocolFixture = {
    readonly decodedEnvelope: { readonly kind: 'event'; } | null;
    readonly deserializedError: Error;
    readonly deserializedWithoutStack: Error;
    readonly outputMessage: WorkerPoolMessage;
    readonly serializedError: SerializedError;
    readonly workerEventMessage: WorkerPoolMessage;
};

function createProtocolFixture(): ProtocolFixture {
    const error = new TypeError('boom');
    const eventEnvelope = childProcessEnvelope('event-message', {
        event: { kind: 'synthetic' },
        kind: 'event'
    });
    const workerEventMessage = { event: { kind: 'synthetic' }, kind: 'event' } as unknown as WorkerPoolMessage;
    const outputMessage = {
        capturedAtMicroseconds: 123,
        chunk: Buffer.from('hello'),
        kind: 'output',
        stream: 'stdout'
    } as const;

    Object.defineProperties(error, {
        code: { value: 'ERR_ACCESS_DENIED' },
        permission: { value: 'FileSystemWrite' },
        resource: { value: '/project/output.txt' },
        stack: { value: undefined }
    });

    return {
        decodedEnvelope: envelopeMessage(
            eventEnvelope,
            'event-message',
            z.strictObject({ event: z.strictObject({ kind: z.literal('synthetic') }), kind: z.literal('event') })
        ),
        deserializedError: deserializeError(serializeError(error)),
        deserializedWithoutStack: deserializeError({
            code: null,
            message: 'no stack',
            name: 'Error',
            permission: null,
            resource: null,
            stack: null
        }),
        outputMessage,
        serializedError: serializeError(error),
        workerEventMessage
    };
}

const assertErrorProtocol = defineCompositeAssertion({
    name: 'error protocol',
    assert(check, fixture: ProtocolFixture) {
        const deserializedFields = fixture.deserializedError as Error & Readonly<Record<string, unknown>>;
        return check.group([
            check.equal(fixture.serializedError.stack, null),
            check.equal(fixture.serializedError.code, 'ERR_ACCESS_DENIED'),
            check.equal(fixture.serializedError.permission, 'FileSystemWrite'),
            check.equal(fixture.serializedError.resource, '/project/output.txt'),
            check.equal(fixture.deserializedError.name, 'TypeError'),
            check.equal(fixture.deserializedError.message, 'boom'),
            check.equal(deserializedFields.code, 'ERR_ACCESS_DENIED'),
            check.equal(deserializedFields.permission, 'FileSystemWrite'),
            check.equal(deserializedFields.resource, '/project/output.txt')
        ]);
    }
});

const assertFallbackErrorProtocol = defineCompositeAssertion({
    name: 'fallback error protocol',
    assert(check, fixture: ProtocolFixture) {
        return check.group([
            check.equal(fixture.deserializedWithoutStack.message, 'no stack'),
            check.equal(serializeError('plain').message, 'plain'),
            check.equal(serializeError('plain').code, null)
        ]);
    }
});

const assertWorkerMessageProtocol = defineCompositeAssertion({
    name: 'worker message protocol',
    assert(check, fixture: ProtocolFixture) {
        return check.group([
            check.equal(fixture.decodedEnvelope?.kind, 'event'),
            check.equal(
                envelopeMessage(
                    childProcessEnvelope('other', {}),
                    'event-message',
                    z.strictObject({ kind: z.literal('event') })
                ),
                null
            ),
            check.equal(serializeWorkerPoolMessage(fixture.workerEventMessage), fixture.workerEventMessage),
            check.equal(
                deserializeWorkerPoolMessage(serializeWorkerPoolMessage(fixture.workerEventMessage)),
                fixture.workerEventMessage
            ),
            check.deepEqual(
                deserializeWorkerPoolMessage(serializeWorkerPoolMessage(fixture.outputMessage)),
                fixture.outputMessage
            )
        ]);
    }
});

export const testNode = suite('worker host protocol', [
    test(
        'closing a worker channel settles completion without a terminal message',
        async function (scope) {
            const channel = createWorkerPoolMessageChannel(function () {
                return undefined;
            });
            scope.cleanup(channel.close);
            channel.close();
            scope.assert.equal(
                await Promise.race([ channel.messagesCompleted, Promise.resolve('pending') ]),
                undefined
            );
            return scope.assert.collect();
        }
    ),
    test(
        'createWorkerPoolHostProcessStarter() forks the shared child host entrypoint',
        function (scope) {
            const child = createChildProcess();
            const forkCalls: {
                readonly childArguments: readonly string[];
                readonly modulePath: string;
                readonly options: unknown;
            }[] = [];
            const startWorkerPoolHost = createWorkerPoolHostProcessStarter({
                childProcessEntryPoint: '/package/source/run/child-process.entry-point.ts',
                fork(modulePath, childArguments, options) {
                    forkCalls.push({ childArguments, modulePath, options });

                    return child;
                }
            });

            scope.assert.equal(
                startWorkerPoolHost({
                    cwd: '/project',
                    environmentVariables: {
                        KEEP: '1',
                        NODE_OPTIONS: '--inspect',
                        NODE_V8_COVERAGE: '/coverage',
                        OMIT: undefined
                    },
                    nodeArguments: [ '--expose-gc' ],
                    testFamily: 'integration'
                }),
                child
            );
            scope.assert.deepEqual(forkCalls, [ {
                childArguments: [ childRoleArgument(workerPoolHostRole) ],
                modulePath: '/package/source/run/child-process.entry-point.ts',
                options: {
                    cwd: '/project',
                    env: {
                        KEEP: '1',
                        NODE_OPTIONS: '--inspect',
                        NODE_V8_COVERAGE: '/coverage'
                    },
                    execArgv: [ '--expose-gc' ],
                    stdio: [ 'ignore', 'pipe', 'pipe', 'ipc' ]
                }
            } ]);

            return scope.assert.collect();
        }
    ),
    test('worker-pool host protocol preserves errors and worker messages', function (scope) {
        const fixture = createProtocolFixture();

        scope.assert(assertErrorProtocol, fixture);
        scope.assert(assertFallbackErrorProtocol, fixture);
        scope.assert(assertWorkerMessageProtocol, fixture);

        return scope.assert.collect();
    }),
    test(
        'worker-pool message channels deliver queued messages before completion',
        async function (scope) {
            const receivedKinds: string[] = [];
            const channel = createWorkerPoolMessageChannel(function recordMessage(message) {
                receivedKinds.push(message.kind);
            });

            try {
                channel.port.postMessage({
                    capturedAtMicroseconds: 1,
                    chunk: Buffer.from('output'),
                    kind: 'output',
                    stream: 'stdout'
                }, []);
                channel.port.postMessage({ kind: 'task-messages-completed' }, []);
                await channel.messagesCompleted;
                scope.assert.deepEqual(receivedKinds, [ 'output', 'task-messages-completed' ]);
            } finally {
                channel.close();
            }

            return scope.assert.collect();
        }
    )
]);
