import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import {
    childProcessEnvelope,
    envelopeMessage
} from './child-process-protocol.ts';
import {
    childRoleArgument,
    workerPoolHostRole
} from './child-process-roles.ts';
import type { SupervisedChildProcess } from './supervised-child-process.ts';
import type {
    WorkerPoolCommand,
    WorkerPoolMessage
} from './worker-pool-protocol.ts';
import {
    deserializeError,
    deserializeWorkerPoolMessage,
    type SerializedError,
    serializeError,
    serializeWorkerPoolMessage,
    type WorkerPoolHostCommand,
    workerPoolHostCorrelationId
} from './worker-pool-host-protocol.ts';
import { createWorkerPoolHostProcessStarter } from './worker-pool-host-process.ts';

function createChildProcess(): SupervisedChildProcess {
    return {
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

function workerPoolCommand(): WorkerPoolCommand {
    return {
        collectionTimeoutMilliseconds: 100,
        cwd: '/project',
        definitionLocationCapture: 'enabled',
        engine: { kind: 'default' },
        hardTimeoutMilliseconds: 200,
        hostProcess: { kind: 'child', nodeArguments: [ '--expose-gc' ] },
        paths: [ 'test.ts' ],
        resourceBudgets: {
            activeResourceCount: null,
            javaScriptEngineHeapBytes: null,
            residentSetBytes: null,
            residentSetGrowthBytesPerSecond: null
        },
        resourceUsageSamplingIntervalMilliseconds: 10,
        scheduling: 'serial',
        testFamily: 'integration',
        timeoutMilliseconds: 100,
        workerLifecycle: 'reuse'
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
        decodedEnvelope: envelopeMessage<{ readonly kind: 'event'; }>(eventEnvelope, 'event-message'),
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

function assertErrorProtocol(scope: OverkillScope, fixture: ProtocolFixture): void {
    const deserializedFields = fixture.deserializedError as Error & Readonly<Record<string, unknown>>;

    scope.assert.equal(fixture.serializedError.stack, null);
    scope.assert.equal(fixture.serializedError.code, 'ERR_ACCESS_DENIED');
    scope.assert.equal(fixture.serializedError.permission, 'FileSystemWrite');
    scope.assert.equal(fixture.serializedError.resource, '/project/output.txt');
    scope.assert.equal(fixture.deserializedError.name, 'TypeError');
    scope.assert.equal(fixture.deserializedError.message, 'boom');
    scope.assert.equal(deserializedFields.code, 'ERR_ACCESS_DENIED');
    scope.assert.equal(deserializedFields.permission, 'FileSystemWrite');
    scope.assert.equal(deserializedFields.resource, '/project/output.txt');
}

function assertFallbackErrorProtocol(scope: OverkillScope, fixture: ProtocolFixture): void {
    scope.assert.equal(fixture.deserializedWithoutStack.message, 'no stack');
    scope.assert.equal(serializeError('plain').message, 'plain');
    scope.assert.equal(serializeError('plain').code, null);
}

function assertWorkerMessageProtocol(scope: OverkillScope, fixture: ProtocolFixture): void {
    scope.assert.equal(fixture.decodedEnvelope?.kind, 'event');
    scope.assert.equal(envelopeMessage(childProcessEnvelope('other', {}), 'event-message'), null);
    scope.assert.equal(serializeWorkerPoolMessage(fixture.workerEventMessage), fixture.workerEventMessage);
    scope.assert.equal(
        deserializeWorkerPoolMessage(serializeWorkerPoolMessage(fixture.workerEventMessage)),
        fixture.workerEventMessage
    );
    scope.assert.deepEqual(
        deserializeWorkerPoolMessage(serializeWorkerPoolMessage(fixture.outputMessage)),
        fixture.outputMessage
    );
}

function emitHostCommand(command: WorkerPoolHostCommand): boolean {
    return process.emit(
        'message',
        childProcessEnvelope(workerPoolHostCorrelationId, command)
    );
}

function assertHostCommandDispatch(scope: OverkillScope, command: WorkerPoolHostCommand): void {
    scope.assert.equal(emitHostCommand(command), true);
}

function assertEntrypointDispatchesHostCommands(scope: OverkillScope): void {
    scope.assert.equal(process.emit('message', childProcessEnvelope('other', { kind: 'destroy' })), true);
    assertHostCommandDispatch(scope, {
        kind: 'run-task',
        task: {
            command: workerPoolCommand(),
            kind: 'collect'
        },
        taskId: 'not-configured'
    });
    assertHostCommandDispatch(scope, { kind: 'abort-task', taskId: 'not-configured' });
    assertHostCommandDispatch(scope, { kind: 'start-resource-tracking', samplingIntervalMilliseconds: 1000 });
    assertHostCommandDispatch(scope, { kind: 'finish-resource-tracking' });
    assertHostCommandDispatch(scope, { kind: 'destroy' });
}

export const testNode = createOverkillSuite({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/worker-pool-host-protocol.test.ts',
    children: [
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'createWorkerPoolHostProcessStarter() forks the shared child host entrypoint',
            body(scope: OverkillScope) {
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
        }),
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'worker-pool host protocol preserves errors and worker messages',
            body(scope: OverkillScope) {
                const fixture = createProtocolFixture();

                assertErrorProtocol(scope, fixture);
                assertFallbackErrorProtocol(scope, fixture);
                assertWorkerMessageProtocol(scope, fixture);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'worker-pool host entrypoint dispatches host commands',
            async body(scope: OverkillScope) {
                await import('./worker-pool-host.entry-point.ts');
                assertEntrypointDispatchesHostCommands(scope);
                await Promise.resolve();

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
