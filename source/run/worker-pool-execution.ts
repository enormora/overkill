import {
    MessageChannel as NodeMessageChannel,
    type MessagePort as NodeMessagePort
} from 'node:worker_threads';
import { createDefaultWorkId, workIdentityKey, type WorkId } from '../engine/identity.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import {
    applyEvent
} from './supervised-run-runtime.ts';
import {
    createStoredRunValue,
    createSupervisedRunState,
    type StoredRunValue,
    type SupervisedCase
} from './supervised-run-state.ts';
import {
    crashError
} from './supervised-run-resource-policy.ts';
import type {
    WorkerPoolCommand,
    WorkerPoolMessage,
    WorkerPoolRunOutput
} from './worker-pool-protocol.ts';
import {
    workerPoolExecutionFacts,
    type WorkerPoolRunRuntime,
    type WorkerPoolTaskRun
} from './worker-pool-runtime.ts';
import type {
    PlacementPlan,
    PlacementLane,
    WorkUnit
} from './run-types.ts';
import {
    createWorkDispatcher,
    type WorkerPoolUnitLease,
    type WorkerPoolWorkDispatcher
} from './worker-pool-work-dispatcher.ts';

type WorkerPoolTaskChannel = {
    readonly close: () => void;
    readonly port: NodeMessagePort;
};

type CompletedTaskRuns = {
    readonly push: (taskRun: WorkerPoolTaskRun) => number;
};

type TaskFailureContext = {
    readonly crashCount: StoredRunValue<number>;
    readonly dispatcher: WorkerPoolWorkDispatcher;
    readonly runtime: WorkerPoolRunRuntime;
};

type TaskExecutionContext = TaskFailureContext & {
    readonly startedAtMilliseconds: number;
};

type WorkerLoopContext = TaskExecutionContext & {
    readonly completedTaskRuns: CompletedTaskRuns;
    readonly lane: PlacementLane;
};

type WorkerTaskRunRequest = {
    readonly channel: WorkerPoolTaskChannel;
    readonly lane: PlacementLane;
    readonly runtime: WorkerPoolRunRuntime;
    readonly startedAtMilliseconds: number;
    readonly taskRun: WorkerPoolTaskRun;
};

type RuntimeReporterEvent = Parameters<WorkerPoolRunRuntime['reporterDelivery']['reportEvent']>[0];

const maximumCrashCount = 3;

function portTransferList(port: NodeMessagePort): readonly NodeMessagePort[] {
    return [ port ];
}

function casesByKey(unit: WorkUnit): ReadonlyMap<string, SupervisedCase> {
    return new Map(
        unit.work.map(function toCaseEntry(work) {
            return [ workIdentityKey(work), { capture: null, id: work.case, workId: work } ];
        })
    );
}

async function recordReporterEventErrors(
    event: RuntimeReporterEvent,
    runtime: WorkerPoolRunRuntime
): Promise<void> {
    const errors = await runtime.reporterDelivery.reportEvent(event);

    if (errors.length > 0) {
        runtime.runState.recordRunnerErrors(errors);
    }
}

function clearTaskTimeout(
    taskRun: WorkerPoolTaskRun,
    dependencies: RunOrchestratorDependencies
): void {
    const timeout = taskRun.timeout.read();

    if (timeout !== null) {
        dependencies.wallClock.clearTimeout(timeout);
        taskRun.timeout.write(null);
    }
}

function startTaskTimeout(taskRun: WorkerPoolTaskRun, runtime: WorkerPoolRunRuntime): void {
    if (taskRun.timeout.read() !== null) {
        return;
    }

    taskRun.timeout.write(runtime.dependencies.wallClock.setTimeout(function abortTimedOutWorker() {
        taskRun.endedByParent.write(true);
        taskRun.requeuePendingCases.write(true);
        taskRun.state.recordRunnerError(crashError(taskRun.state, 'Worker-pool work unit exceeded hard timeout.'));
        taskRun.state.recordTerminalActiveCases(
            'crashed',
            runtime.dependencies.wallClock.currentTimestampInMilliseconds
        );
        taskRun.controller.abort();
    }, runtime.resolvedRun.facts.execution.timeoutPolicy.hardMilliseconds));
}

function handleWorkerEvent(
    event: RuntimeReporterEvent,
    taskRun: WorkerPoolTaskRun,
    runtime: WorkerPoolRunRuntime
): void {
    if (event.kind === 'test-start') {
        taskRun.startedCases.add(workIdentityKey(event.workId ?? createDefaultWorkId(event.case)));
        startTaskTimeout(taskRun, runtime);
    }

    const reportedEvent: RuntimeReporterEvent = event.kind === 'test-end'
        ? {
            ...event,
            artifacts: [
                ...event.artifacts,
                ...taskRun.state.caseArtifacts(event.case)
            ]
        }
        : event;

    applyEvent(
        reportedEvent,
        taskRun.state,
        casesByKey(taskRun.unit),
        runtime.dependencies.wallClock.currentTimestampInMilliseconds
    );

    if (reportedEvent.kind === 'test-end' && taskRun.state.activeCases.size === 0) {
        clearTaskTimeout(taskRun, runtime.dependencies);
    }

    runtime.reporterEvents.add(recordReporterEventErrors(reportedEvent, runtime));
}

function handleWorkerMessage(
    message: WorkerPoolMessage,
    taskRun: WorkerPoolTaskRun,
    runtime: WorkerPoolRunRuntime
): void {
    if (message.kind === 'output') {
        taskRun.state.recordCapturedOutput(
            message.stream,
            Buffer.from(message.chunk),
            message.capturedAtMilliseconds
        );
    } else {
        handleWorkerEvent(message.event, taskRun, runtime);
    }
}

function observeTaskMessages(taskRun: WorkerPoolTaskRun, runtime: WorkerPoolRunRuntime): WorkerPoolTaskChannel {
    const { port1, port2 } = new NodeMessageChannel();

    port2.on('message', function receiveWorkerMessage(message: WorkerPoolMessage) {
        handleWorkerMessage(message, taskRun, runtime);
    });

    return {
        close() {
            port2.close();
        },
        port: port1
    };
}

function workerPoolEngine(runtime: WorkerPoolRunRuntime): WorkerPoolCommand['engine'] {
    if (runtime.resolvedRun.engine.kind === 'instance') {
        throw new Error('Instance engines are not supported with worker-pool execution. Use a module engine.');
    }

    return runtime.resolvedRun.engine;
}

function unitPaths(unit: WorkUnit): readonly string[] {
    return Array.from(
        new Set(unit.work.map(function toFile(work) {
            if (work.case.file === null) {
                throw new Error('Worker-pool work units require file-backed cases.');
            }

            return work.case.file;
        }))
    );
}

function createRunCommand(runtime: WorkerPoolRunRuntime, unit: WorkUnit): WorkerPoolCommand {
    const execution = workerPoolExecutionFacts(runtime.resolvedRun);

    return {
        collectionTimeoutMilliseconds: runtime.resolvedRun.facts.execution.timeoutPolicy.collectionMilliseconds,
        cwd: runtime.resolvedRun.cwd,
        definitionLocationCapture: 'disabled',
        engine: workerPoolEngine(runtime),
        hardTimeoutMilliseconds: runtime.resolvedRun.facts.execution.timeoutPolicy.hardMilliseconds,
        hostProcess: execution.hostProcess.kind === 'direct'
            ? { kind: 'direct' }
            : {
                kind: 'child',
                nodeArguments: Array.from(execution.hostProcess.nodeArguments)
            },
        paths: unitPaths(unit),
        resourceBudgets: runtime.resolvedRun.facts.execution.resourceUsagePolicy.budgets,
        resourceUsageSamplingIntervalMilliseconds: runtime
            .resolvedRun
            .facts
            .execution
            .resourceUsagePolicy
            .samplingIntervalMilliseconds,
        scheduling: unit.scheduling,
        testFamily: runtime.resolvedRun.facts.execution.testFamily,
        timeoutMilliseconds: runtime.resolvedRun.facts.execution.timeoutPolicy.softMilliseconds,
        workerLifecycle: unit.workerLifecycle
    };
}

function isWorkerPoolRunOutput(value: unknown): value is WorkerPoolRunOutput {
    return value !== null &&
        typeof value === 'object' &&
        Object.hasOwn(value, 'result');
}

async function runWorkerTask(request: WorkerTaskRunRequest): Promise<WorkerPoolRunOutput> {
    const output: unknown = await request.runtime.pool.run({
        assignedWork: request.taskRun.unit.work,
        command: createRunCommand(request.runtime, request.taskRun.unit),
        kind: 'run',
        lane: request.lane.id,
        port: request.channel.port,
        startedAtMilliseconds: request.startedAtMilliseconds
    }, {
        name: 'runTask',
        signal: request.taskRun.controller.signal,
        transferList: portTransferList(request.channel.port)
    });

    if (!isWorkerPoolRunOutput(output)) {
        throw new Error('Worker-pool task returned an invalid result.');
    }

    return output;
}

async function runFileUnit(
    taskRun: WorkerPoolTaskRun,
    runtime: WorkerPoolRunRuntime,
    lane: PlacementLane,
    startedAtMilliseconds: number
): Promise<WorkerPoolRunOutput> {
    const channel = observeTaskMessages(taskRun, runtime);

    try {
        return await runWorkerTask({ channel, lane, runtime, startedAtMilliseconds, taskRun });
    } finally {
        channel.close();
    }
}

function createTaskRun(unit: WorkUnit): WorkerPoolTaskRun {
    return {
        controller: new AbortController(),
        endedByParent: createStoredRunValue(false),
        requeuePendingCases: createStoredRunValue(false),
        state: createSupervisedRunState(),
        startedCases: new Set(),
        timeout: createStoredRunValue<ReturnType<RunOrchestratorDependencies['wallClock']['setTimeout']> | null>(null),
        unit
    };
}

function pendingWork(taskRun: WorkerPoolTaskRun): readonly WorkId[] {
    return taskRun.unit.work.filter(function caseHasNotStarted(work) {
        return !taskRun.startedCases.has(workIdentityKey(work));
    });
}

function pendingWorkUnit(taskRun: WorkerPoolTaskRun): WorkUnit | null {
    const work = pendingWork(taskRun);
    const firstWork = work[0];

    return firstWork === undefined
        ? null
        : {
            ...taskRun.unit,
            work: [ firstWork, ...work.slice(1) ]
        };
}

function crashReason(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function recordRunCrash(runtime: WorkerPoolRunRuntime, message: string, cause: unknown): void {
    runtime.runState.recordRunnerError({
        attributedTo: null,
        attributedToWork: null,
        cause,
        message,
        subtype: 'crash'
    });
}

function markActiveTasksCrashed(runtime: WorkerPoolRunRuntime): void {
    for (const activeTask of runtime.activeTasks) {
        activeTask.endedByParent.write(true);
        activeTask.requeuePendingCases.write(false);
        activeTask.state.recordRunnerError(crashError(activeTask.state, 'Worker-pool execution stopped.'));
        activeTask.state.recordTerminalActiveCases(
            'crashed',
            runtime.dependencies.wallClock.currentTimestampInMilliseconds
        );
        clearTaskTimeout(activeTask, runtime.dependencies);
        activeTask.controller.abort();
    }
}

function stopAfterCrashLimit(
    runtime: WorkerPoolRunRuntime,
    dispatcher: WorkerPoolWorkDispatcher,
    crashCount: number
): void {
    runtime.terminalFailure.write(true);
    recordRunCrash(runtime, 'Worker-pool stopped after 3 worker crashes.', { crashCount });
    dispatcher.clear();
    markActiveTasksCrashed(runtime);
}

function recordWorkerCrash(
    runtime: WorkerPoolRunRuntime,
    crashCount: StoredRunValue<number>,
    dispatcher: WorkerPoolWorkDispatcher
): boolean {
    const nextCrashCount = crashCount.read() + 1;
    crashCount.write(nextCrashCount);

    if (nextCrashCount >= maximumCrashCount) {
        stopAfterCrashLimit(runtime, dispatcher, nextCrashCount);
        return true;
    }

    return false;
}

function handleParentEndedFailure(
    taskRun: WorkerPoolTaskRun,
    context: TaskFailureContext
): WorkUnit | null {
    if (!taskRun.requeuePendingCases.read()) {
        return null;
    }

    return recordWorkerCrash(context.runtime, context.crashCount, context.dispatcher) ? null : pendingWorkUnit(taskRun);
}

function handleTaskFailure(
    error: unknown,
    taskRun: WorkerPoolTaskRun,
    context: TaskFailureContext
): WorkUnit | null {
    if (taskRun.endedByParent.read()) {
        return handleParentEndedFailure(taskRun, context);
    }

    taskRun.state.recordRunnerError(crashError(taskRun.state, crashReason(error)));
    taskRun.state.recordTerminalActiveCases(
        'crashed',
        context.runtime.dependencies.wallClock.currentTimestampInMilliseconds
    );

    return recordWorkerCrash(context.runtime, context.crashCount, context.dispatcher) ? null : pendingWorkUnit(taskRun);
}

async function recordCompletedTaskRun(
    taskRun: WorkerPoolTaskRun,
    lease: WorkerPoolUnitLease,
    context: TaskExecutionContext
): Promise<void> {
    const output = await runFileUnit(taskRun, context.runtime, lease.lane, context.startedAtMilliseconds);
    context.dispatcher.finish(lease, true);
    context.runtime.taskResults.push(output.result);
}

function recordFailedTaskRun(
    error: unknown,
    taskRun: WorkerPoolTaskRun,
    lease: WorkerPoolUnitLease,
    context: TaskExecutionContext
): void {
    const unit = handleTaskFailure(error, taskRun, context);

    context.dispatcher.finish(lease, taskRun.startedCases.size > 0);

    if (unit !== null) {
        context.dispatcher.requeue(unit);
    }
}

async function executeTaskRun(
    taskRun: WorkerPoolTaskRun,
    lease: WorkerPoolUnitLease,
    context: TaskExecutionContext
): Promise<void> {
    context.runtime.activeTasks.add(taskRun);

    try {
        await recordCompletedTaskRun(taskRun, lease, context);
    } catch (error: unknown) {
        recordFailedTaskRun(error, taskRun, lease, context);
    } finally {
        clearTaskTimeout(taskRun, context.runtime.dependencies);
        context.runtime.activeTasks.delete(taskRun);
    }
}

async function runWorkerLoop(context: WorkerLoopContext): Promise<void> {
    while (!context.runtime.terminalFailure.read()) {
        const lease = context.dispatcher.pull(context.lane);

        if (lease === null && !context.dispatcher.blocked(context.lane)) {
            return;
        }

        if (lease === null) {
            await context.dispatcher.waitForChange();
        } else {
            const taskRun = createTaskRun(lease.unit);
            await executeTaskRun(taskRun, lease, context);
            context.completedTaskRuns.push(taskRun);
        }
    }
}

export async function executeWorkerPoolUnits(
    runtime: WorkerPoolRunRuntime,
    placementPlan: PlacementPlan,
    startedAtMilliseconds: number
): Promise<readonly WorkerPoolTaskRun[]> {
    const completedTaskRuns: WorkerPoolTaskRun[] = [];
    const crashCount = createStoredRunValue(0);
    const dispatcher = createWorkDispatcher(runtime, placementPlan);

    await Promise.all(
        placementPlan.lanes.map(async function runLoop(lane) {
            await runWorkerLoop({
                completedTaskRuns,
                crashCount,
                dispatcher,
                lane,
                runtime,
                startedAtMilliseconds
            });
        })
    );

    return completedTaskRuns;
}
