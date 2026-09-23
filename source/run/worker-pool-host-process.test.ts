import type { MessagePort as WorkerMessagePort } from 'node:worker_threads';
import type {
    ResourceUsageSnapshot,
    RunResourceUsage
} from '../engine/run-result.ts';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import {
    childProcessEnvelope,
    envelopeMessage
} from './child-process-protocol.ts';
import type {
    CreatedWorkerPool,
    WorkerPoolCreationOptions,
    WorkerPoolResourceUsageTracker,
    WorkerPoolHostProcessStartOptions
} from './run-orchestrator-dependencies.ts';
import type { SupervisedChildProcess } from './supervised-child-process.ts';
import type {
    WorkerPoolCommand,
    WorkerPoolMessage
} from './worker-pool-protocol.ts';
import {
    serializeError,
    serializeWorkerPoolMessage,
    type WorkerPoolHostCommand,
    workerPoolHostCorrelationId,
    type WorkerPoolHostMessage
} from './worker-pool-host-protocol.ts';
import { createHostedWorkerPool } from './worker-pool-host-process.ts';

type ChildOutput = NonNullable<SupervisedChildProcess['stdout']> & {
    readonly emit: (text: string) => void;
};

type FakePort = {
    readonly messages: () => readonly WorkerPoolMessage[];
    readonly postMessage: (message: WorkerPoolMessage) => void;
};

type FakeHostChild = SupervisedChildProcess & {
    readonly emitError: (error: Error) => void;
    readonly emitExit: () => void;
    readonly emitMessage: (message: WorkerPoolHostMessage) => void;
    readonly sentCommands: () => readonly WorkerPoolHostCommand[];
    readonly stderr: ChildOutput;
    readonly stdout: ChildOutput;
};

type HostedPoolFixture = {
    readonly child: FakeHostChild;
    readonly pool: CreatedWorkerPool;
};

type RunningTaskFixture = HostedPoolFixture & {
    readonly result: Promise<unknown>;
};

type ForwardingFixture = RunningTaskFixture & {
    readonly controller: AbortController;
    readonly output: readonly string[];
    readonly port: FakePort;
};

type ResourceTrackingFixture = HostedPoolFixture & {
    readonly observedSamples: readonly number[];
    readonly tracker: WorkerPoolResourceUsageTracker;
};

function createChildOutput(): ChildOutput {
    let dataListener: (chunk: Uint8Array) => void = function ignoreOutput() {
        return undefined;
    };

    return {
        emit(text) {
            dataListener(Buffer.from(text));
        },
        on(_event, listener) {
            dataListener = listener;
        }
    };
}

function createFakePort(): FakePort {
    const messages: WorkerPoolMessage[] = [];

    return {
        messages() {
            return messages;
        },
        postMessage(message) {
            messages.push(message);
        }
    };
}

function createFakeHostChild(): FakeHostChild {
    const commands: WorkerPoolHostCommand[] = [];
    const errorListeners: ((error: Error) => void)[] = [];
    const exitListeners: (() => void)[] = [];
    const messageListeners: ((message: unknown) => void)[] = [];
    const stdout = createChildOutput();
    const stderr = createChildOutput();

    function emitMessage(message: WorkerPoolHostMessage): void {
        for (const listener of messageListeners) {
            listener(childProcessEnvelope(workerPoolHostCorrelationId, message));
        }
    }

    return {
        emitError(error) {
            for (const listener of errorListeners) {
                listener(error);
            }
        },
        emitExit() {
            for (const listener of exitListeners) {
                listener();
            }
        },
        emitMessage,
        exitCode: null,
        kill() {
            return true;
        },
        on(...registration) {
            const [ event, listener ] = registration;

            if (event === 'error') {
                errorListeners.push(listener);
            } else if (event === 'exit') {
                exitListeners.push(listener);
            } else {
                messageListeners.push(listener);
            }
        },
        pid: 12,
        send(message) {
            const command = envelopeMessage<WorkerPoolHostCommand>(message, workerPoolHostCorrelationId);

            if (command === null) {
                return false;
            }

            commands.push(command);

            if (command.kind === 'configure') {
                emitMessage({ kind: 'configured' });
            } else if (command.kind === 'destroy') {
                emitMessage({ kind: 'destroyed' });
                for (const listener of exitListeners) {
                    listener();
                }
            }

            return true;
        },
        sentCommands() {
            return commands;
        },
        signalCode: null,
        stderr,
        stdout
    };
}

function workerPoolOptions(overrides: Partial<WorkerPoolCreationOptions> = {}): WorkerPoolCreationOptions {
    return {
        cwd: '/project',
        hostProcess: { kind: 'child', nodeArguments: [ '--expose-gc' ] },
        testFamily: 'integration',
        workerCount: 2,
        workerLifecycle: 'reuse',
        ...overrides
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

function messagePort(port: FakePort): WorkerMessagePort {
    return port as unknown as WorkerMessagePort;
}

function abortSignal(): AbortSignal {
    const controller = new AbortController();

    return controller.signal;
}

function commandKind(command: WorkerPoolHostCommand): WorkerPoolHostCommand['kind'] {
    return command.kind;
}

function newRangeError(message: string): RangeError {
    return new RangeError(message);
}

function resourceUsageSample(
    capturedAtMicroseconds: number,
    residentSetBytes: number
): ResourceUsageSnapshot {
    return {
        activeResourceCount: capturedAtMicroseconds / 10,
        activeResourceTypes: [ 'temporary-directory' ],
        capturedAtMicroseconds,
        javaScriptEngineHeapBytes: residentSetBytes / 2,
        residentSetBytes
    };
}

const ignoreStartOptions: (options: WorkerPoolHostProcessStartOptions) => void = function ignoreStartOptions() {
    return undefined;
};

function createPoolFixture(
    options: WorkerPoolCreationOptions,
    onStart: (options: WorkerPoolHostProcessStartOptions) => void
): HostedPoolFixture {
    const child = createFakeHostChild();

    return {
        child,
        pool: createHostedWorkerPool({
            environmentVariables: {},
            options,
            startWorkerPoolHost(startOptions) {
                onStart(startOptions);

                return child;
            }
        })
    };
}

async function waitForRunTaskCommand(
    child: FakeHostChild
): Promise<Extract<WorkerPoolHostCommand, { readonly kind: 'run-task'; }>> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
        const command = child.sentCommands().find(function isRunTask(candidate) {
            return candidate.kind === 'run-task';
        });

        if (command !== undefined) {
            return command;
        }

        await Promise.resolve();
    }

    throw new Error('Expected hosted worker-pool run-task command.');
}

async function runTask(pool: CreatedWorkerPool): Promise<unknown> {
    return pool.run({
        assignedUnits: [ {
            traceUnit: {
                key: 'test.ts',
                mode: 'case',
                runtimes: [],
                workload: null
            },
            work: [ { file: 'test.ts', index: 0 } ]
        } ],
        assignedWork: [ { file: 'test.ts', index: 0 } ],
        command: workerPoolCommand(),
        kind: 'run',
        port: messagePort(createFakePort()),
        startedAtMilliseconds: 100
    }, {
        name: 'run',
        signal: abortSignal(),
        transferList: []
    });
}

async function runCollectTask(
    pool: CreatedWorkerPool,
    port: FakePort,
    signal: AbortSignal
): Promise<unknown> {
    return pool.run({
        kind: 'collect',
        command: workerPoolCommand(),
        port: messagePort(port)
    }, {
        name: 'collect',
        signal,
        transferList: []
    });
}

async function startRunTask(fixture: HostedPoolFixture): Promise<RunningTaskFixture> {
    const result = runTask(fixture.pool);

    await waitForRunTaskCommand(fixture.child);

    return { ...fixture, result };
}

function createForwardingFixture(scope: OverkillScope): ForwardingFixture {
    const child = createFakeHostChild();
    const output: string[] = [];
    const pool = createHostedWorkerPool({
        environmentVariables: { NODE_OPTIONS: '--inspect' },
        options: workerPoolOptions(),
        startWorkerPoolHost(options) {
            scope.assert.deepEqual(options.nodeArguments, [ '--expose-gc' ]);
            scope.assert.equal(options.testFamily, 'integration');

            return child;
        }
    });
    const port = createFakePort();
    const controller = new AbortController();

    pool.setHostOutputSink?.(function collectOutput(stream, chunk) {
        output.push(`${stream}:${Buffer.from(chunk).toString()}`);
    });

    return { child, controller, output, pool, port, result: runCollectTask(pool, port, controller.signal) };
}

function emitTaskOutput(
    child: FakeHostChild,
    runTaskCommand: Extract<WorkerPoolHostCommand, { readonly kind: 'run-task'; }>
): void {
    child.stdout.emit('host stdout');
    child.stderr.emit('host stderr');
    child.emitMessage({
        kind: 'task-message',
        message: serializeWorkerPoolMessage({
            capturedAtMicroseconds: 50,
            chunk: Buffer.from('task stdout'),
            kind: 'output',
            stream: 'stdout'
        }),
        taskId: runTaskCommand.taskId
    });
}

function resolveTask(
    child: FakeHostChild,
    runTaskCommand: Extract<WorkerPoolHostCommand, { readonly kind: 'run-task'; }>
): void {
    child.emitMessage({
        kind: 'task-result',
        result: { ok: true },
        taskId: runTaskCommand.taskId
    });
}

async function assertForwardingResult(scope: OverkillScope, fixture: ForwardingFixture): Promise<void> {
    scope.assert.deepEqual(await fixture.result, { ok: true });
    scope.assert.deepEqual(fixture.output, [ 'stdout:host stdout', 'stderr:host stderr' ]);
    scope.assert.deepEqual(fixture.port.messages(), [ {
        capturedAtMicroseconds: 50,
        chunk: Buffer.from('task stdout'),
        kind: 'output',
        stream: 'stdout'
    } ]);
    scope.assert.deepEqual(fixture.child.sentCommands().map(commandKind), [ 'configure', 'run-task', 'abort-task' ]);
    scope.assert.equal(fixture.pool.options.maxThreads, 2);
}

function createTrackingFixture(): ResourceTrackingFixture {
    const fixture = createPoolFixture(
        workerPoolOptions({ workerLifecycle: 'fresh-worker-per-unit' }),
        ignoreStartOptions
    );
    const tracker = fixture.pool.createResourceUsageTracker?.({ samplingIntervalMilliseconds: 25 });
    const observedSamples: number[] = [];

    if (tracker === undefined) {
        throw new Error('Expected hosted worker-pool resource tracker.');
    }

    tracker.start(function observeSample(sample) {
        observedSamples.push(sample.capturedAtMicroseconds);
    });

    return { ...fixture, observedSamples, tracker };
}

async function collectTwoResourceSamples(fixture: ResourceTrackingFixture): Promise<RunResourceUsage> {
    const start = fixture.tracker.waitForStart?.();

    await Promise.resolve();
    fixture.child.emitMessage({ kind: 'resource-sample', sample: resourceUsageSample(10, 200) });
    await start;
    fixture.child.emitMessage({ kind: 'resource-sample', sample: resourceUsageSample(20, 260) });
    await fixture.tracker.waitForStart?.();

    return fixture.tracker.finish();
}

async function startTrackingWithOneSample(
    child: FakeHostChild,
    tracker: WorkerPoolResourceUsageTracker
): Promise<void> {
    tracker.start();
    const start = tracker.waitForStart?.();

    await Promise.resolve();
    child.emitMessage({ kind: 'resource-sample', sample: resourceUsageSample(10, 200) });
    await start;
}

export const testNode = createOverkillSuite({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/worker-pool-host-process.test.ts',
    children: [
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'createHostedWorkerPool() reports a missing host resource sample',
            body(scope: OverkillScope) {
                const { pool } = createPoolFixture(workerPoolOptions(), ignoreStartOptions);
                const tracker = pool.createResourceUsageTracker?.({ samplingIntervalMilliseconds: 25 });

                scope.require.defined(tracker);
                scope.assert.throws(function finishWithoutSamples() {
                    tracker.finish();
                }, {
                    message: 'Hosted worker-pool resource tracking did not receive samples.'
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'createHostedWorkerPool() rejects task errors from the child host',
            async body(scope: OverkillScope) {
                const fixture = await startRunTask(createPoolFixture(
                    workerPoolOptions({ hostProcess: { kind: 'direct' } }),
                    function expectDirectHost(options) {
                        scope.assert.deepEqual(options.nodeArguments, []);
                    }
                ));
                const runTaskCommand = await waitForRunTaskCommand(fixture.child);

                fixture.child.emitMessage({
                    error: serializeError(newRangeError('task failed')),
                    kind: 'task-error',
                    taskId: runTaskCommand.taskId
                });

                await scope.assert.rejects(async function waitForTaskError() {
                    await fixture.result;
                }, {
                    message: 'task failed',
                    name: 'RangeError'
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'createHostedWorkerPool() forwards tasks, output, messages, and aborts',
            async body(scope: OverkillScope) {
                const fixture = createForwardingFixture(scope);
                const runTaskCommand = await waitForRunTaskCommand(fixture.child);

                emitTaskOutput(fixture.child, runTaskCommand);
                fixture.controller.abort();
                resolveTask(fixture.child, runTaskCommand);
                await assertForwardingResult(scope, fixture);
                scope.assert.equal(fixture.pool.options.isolateWorkers, false);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'createHostedWorkerPool() exposes host resource usage samples',
            async body(scope: OverkillScope) {
                const fixture = createTrackingFixture();
                const usage = await collectTwoResourceSamples(fixture);

                scope.assert.deepEqual(fixture.observedSamples, [ 10, 20 ]);
                scope.assert.equal(usage.sampleCount, 2);
                scope.assert.equal(usage.peakResidentSetBytes, 260);
                scope.assert.equal(fixture.pool.options.isolateWorkers, true);
                scope.assert.deepEqual(
                    fixture.child.sentCommands().map(commandKind),
                    [ 'configure', 'start-resource-tracking', 'finish-resource-tracking' ]
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'createHostedWorkerPool() rejects pending tasks when the host errors',
            async body(scope: OverkillScope) {
                const fixture = await startRunTask(createPoolFixture(workerPoolOptions(), ignoreStartOptions));

                fixture.child.emitError(new Error('host failed'));

                await scope.assert.rejects(async function waitForHostFailure() {
                    await fixture.result;
                }, { message: 'host failed' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'createHostedWorkerPool() destroys an active host and ignores idle destroy',
            async body(scope: OverkillScope) {
                const fixture = createPoolFixture(workerPoolOptions(), ignoreStartOptions);
                const tracker = fixture.pool.createResourceUsageTracker?.({ samplingIntervalMilliseconds: 25 });

                scope.require.defined(tracker);
                await startTrackingWithOneSample(fixture.child, tracker);
                await fixture.pool.destroy();
                await fixture.pool.destroy();

                scope.assert.deepEqual(
                    fixture.child.sentCommands().map(commandKind),
                    [ 'configure', 'start-resource-tracking', 'destroy' ]
                );

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
