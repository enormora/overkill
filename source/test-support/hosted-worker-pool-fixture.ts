import type { TestScope } from '@overkill-dev/test';
import { createDeterministicClock } from '@enormora/clock';
import { createDefaultWorkId } from '../engine/identity.ts';
import {
    defaultFailureArtifactPolicy,
    type ProcessUsageSnapshot,
    type RunProcessUsage
} from '../packages/engine/engine.entry-point.ts';
import type {
    CreatedWorkerPool,
    WorkerPoolCreationOptions,
    WorkerPoolProcessUsageTracker,
    WorkerPoolHostProcessStartOptions
} from '../run/run-orchestrator-dependencies.ts';
import type { WorkerPoolCommand, WorkerPoolTask } from '../run/worker-pool-protocol.ts';
import { serializeWorkerPoolMessage, type WorkerPoolHostCommand } from '../run/worker-pool-host-protocol.ts';
import { createHostedWorkerPool } from '../run/worker-pool-host-process.ts';
import { createFakeHostChild, type FakeHostChild } from './fake-worker-pool-host-process.ts';
import {
    createWorkerMessagePortFixture as createFakePort,
    type WorkerMessagePortFixture as FakePort
} from './worker-message-port-fixture.ts';

type WorkerMessagePort = Readonly<WorkerPoolTask['port']>;

const maximumStartupTurns = 5;
const sampleScaling = { microsecondsPerResource: 10, residentBytesPerHeapByte: 2 };
const processUsageSamples = {
    first: { capturedAtMicroseconds: 10, residentSetBytes: 200 },
    second: { capturedAtMicroseconds: 20, residentSetBytes: 260 }
};

type HostedPoolFixture = {
    readonly child: FakeHostChild;
    readonly pool: CreatedWorkerPool;
};

type RunningTaskFixture = HostedPoolFixture & {
    readonly result: Promise<unknown>;
};

export type ForwardingFixture = RunningTaskFixture & {
    readonly controller: AbortController;
    readonly output: readonly string[];
    readonly port: FakePort;
};

type ProcessUsageTrackingFixture = HostedPoolFixture & {
    readonly observedSamples: readonly number[];
    readonly tracker: WorkerPoolProcessUsageTracker;
};

export function workerPoolOptions(overrides: Partial<WorkerPoolCreationOptions> = {}): WorkerPoolCreationOptions {
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
        implementations: null,
        implementationContext: { projectRoot: '/project' },

        family: null,
        debug: { mode: 'off', selectors: [] },
        failureArtifacts: defaultFailureArtifactPolicy,
        capture: 'buffered',
        replay: null,
        snapshots: null,
        seed: '0',
        benchmarkNormalization: null,
        benchmarkGarbageCollection: null,
        propertyPolicy: null,
        attachmentEndpoint: null,
        retryPolicy: null,
        collectionTimeoutMilliseconds: 100,
        cwd: '/project',
        definitionLocationCapture: 'enabled',
        engine: { kind: 'default' },
        hardTimeoutMilliseconds: 200,
        maxConcurrency: 5,
        hostProcess: { kind: 'child', nodeArguments: [ '--expose-gc' ] },
        paths: [ 'test.ts' ],
        processBudgets: {
            activeResourceCount: null,
            javaScriptEngineHeapBytes: null,
            residentSetBytes: null,
            residentSetGrowthBytesPerSecond: null
        },
        processUsageSamplingIntervalMilliseconds: 10,
        root: { annotations: {}, controls: {}, title: process.cwd() },
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

export function commandKind(command: WorkerPoolHostCommand): WorkerPoolHostCommand['kind'] {
    return command.kind;
}

export function newRangeError(message: string): RangeError {
    return new RangeError(message);
}

function processUsageSample(
    input: Pick<ProcessUsageSnapshot, 'capturedAtMicroseconds' | 'residentSetBytes'>
): ProcessUsageSnapshot {
    const { capturedAtMicroseconds, residentSetBytes } = input;
    return {
        activeResourceCount: capturedAtMicroseconds / sampleScaling.microsecondsPerResource,
        activeResourceTypes: [ 'temporary-directory' ],
        capturedAtMicroseconds,
        javaScriptEngineHeapBytes: residentSetBytes / sampleScaling.residentBytesPerHeapByte,
        residentSetBytes
    };
}

export const ignoreStartOptions: (options: WorkerPoolHostProcessStartOptions) => void = function ignoreStartOptions() {
    return undefined;
};

function closePoolAfterTest(cleanup: TestScope['cleanup'], fixture: HostedPoolFixture): void {
    cleanup(async function closeHostedPool() {
        await fixture.pool.destroy();
        fixture.child.emitExit();
    });
}

export function createPoolFixture(
    cleanup: TestScope['cleanup'],
    options: WorkerPoolCreationOptions,
    onStart: (options: WorkerPoolHostProcessStartOptions) => void
): HostedPoolFixture {
    const child = createFakeHostChild();

    const fixture = {
        child,
        pool: createHostedWorkerPool({
            wallClock: createDeterministicClock({ initialUnixEpochMicroseconds: 0n }),
            environmentVariables: {},
            options,
            startWorkerPoolHost(startOptions) {
                onStart(startOptions);

                return child;
            }
        })
    };
    closePoolAfterTest(cleanup, fixture);
    return fixture;
}

export async function waitForRunTaskCommand(
    child: FakeHostChild
): Promise<Extract<WorkerPoolHostCommand, { readonly kind: 'run-task'; }>> {
    for (let attempt = 0; attempt < maximumStartupTurns; attempt += 1) {
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
        workloadInputs: [],
        assignedUnits: [ {
            traceUnit: { familyVariant: null, key: 'test.ts', mode: 'case', runtimes: [], workload: null },
            attempt: 'attempt-0',
            work: [ createDefaultWorkId({ file: 'test.ts', suite: [], title: 'case', params: null }) ]
        } ],
        assignedWork: [ createDefaultWorkId({ file: 'test.ts', suite: [], title: 'case', params: null }) ],
        boundaryUseCounts: [],
        lane: 'lane',
        lifecycle: { endpoint: null, token: 'lifecycle' },
        projectedResources: { resources: [] },
        runWork: [ createDefaultWorkId({ file: 'test.ts', suite: [], title: 'case', params: null }) ],
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

export async function startRunTask(fixture: HostedPoolFixture): Promise<RunningTaskFixture> {
    const result = runTask(fixture.pool);

    await waitForRunTaskCommand(fixture.child);

    return { ...fixture, result };
}

export function emitTaskOutput(
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

export function resolveTask(
    child: FakeHostChild,
    runTaskCommand: Extract<WorkerPoolHostCommand, { readonly kind: 'run-task'; }>
): void {
    child.emitMessage({
        kind: 'task-result',
        result: { ok: true },
        taskId: runTaskCommand.taskId
    });
}

export function createForwardingFixture(
    cleanup: TestScope['cleanup'],
    onStart: (options: WorkerPoolHostProcessStartOptions) => void
): ForwardingFixture {
    const child = createFakeHostChild();
    const output: string[] = [];
    const pool = createHostedWorkerPool({
        wallClock: createDeterministicClock({ initialUnixEpochMicroseconds: 0n }),
        environmentVariables: { NODE_OPTIONS: '--inspect' },
        options: workerPoolOptions(),
        startWorkerPoolHost(options) {
            onStart(options);
            return child;
        }
    });
    closePoolAfterTest(cleanup, { child, pool });
    const port = createFakePort();
    const controller = new AbortController();
    pool.setHostOutputSink?.(function (stream, chunk) {
        output.push(`${stream}:${Buffer.from(chunk).toString()}`);
    });
    return { child, controller, output, pool, port, result: runCollectTask(pool, port, controller.signal) };
}

export function createTrackingFixture(cleanup: TestScope['cleanup']): ProcessUsageTrackingFixture {
    const fixture = createPoolFixture(
        cleanup,
        workerPoolOptions({ workerLifecycle: 'fresh-worker-per-unit' }),
        ignoreStartOptions
    );
    const tracker = fixture.pool.createProcessUsageTracker?.({ samplingIntervalMilliseconds: 25 });
    const observedSamples: number[] = [];

    if (tracker === undefined) {
        throw new Error('Expected hosted worker-pool resource tracker.');
    }

    tracker.start(function observeSample(sample) {
        observedSamples.push(sample.capturedAtMicroseconds);
    });

    return { ...fixture, observedSamples, tracker };
}

export async function collectTwoProcessUsageSamples(fixture: ProcessUsageTrackingFixture): Promise<RunProcessUsage> {
    const start = fixture.tracker.waitForStart?.();

    await Promise.resolve();
    fixture.child.emitMessage({ kind: 'process-usage-sample', sample: processUsageSample(processUsageSamples.first) });
    await start;
    fixture.child.emitMessage({ kind: 'process-usage-sample', sample: processUsageSample(processUsageSamples.second) });
    await fixture.tracker.waitForStart?.();

    return fixture.tracker.finish();
}

export async function startTrackingWithOneSample(
    child: FakeHostChild,
    tracker: WorkerPoolProcessUsageTracker
): Promise<void> {
    tracker.start();
    const start = tracker.waitForStart?.();

    await Promise.resolve();
    child.emitMessage({ kind: 'process-usage-sample', sample: processUsageSample(processUsageSamples.first) });
    await start;
}
