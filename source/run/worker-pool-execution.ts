import {
    MessageChannel as NodeMessageChannel,
    type MessagePort as NodeMessagePort
} from 'node:worker_threads';
import { workIdentityKey, type WorkId } from '../engine/identity.ts';
import {
    createStoredRunValue,
    createSupervisedRunState,
    type StoredRunValue
} from './supervised-run-state.ts';
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
import { createWorkDispatcher } from './worker-pool-work-dispatcher.ts';
import type {
    WorkerPoolUnitLease,
    WorkerPoolWorkDispatcher
} from './worker-pool-dispatch-state.ts';
import {
    recordCancelledHedgedTaskRun,
    recordCompletedHedgedTaskRun,
    unitCanUseBufferedHedging,
    type HedgedAuthorities
} from './worker-pool-hedged-arbitration.ts';
import {
    clearTaskTimeout,
    handleWorkerMessage,
    recordTaskCrash
} from './worker-pool-task-events.ts';

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
    readonly authorities: HedgedAuthorities;
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
type HostRunnerErrors = ReturnType<NonNullable<WorkerPoolRunRuntime['pool']['takeHostRunnerErrors']>>;

const maximumCrashCount = 3;

type BufferedReporterEvent = ReturnType<
    WorkerPoolTaskRun['bufferedReporterEvents'][typeof Symbol.iterator]
> extends IterableIterator<infer Event> ? Event : never;

function createReporterEventBuffer(): WorkerPoolTaskRun['bufferedReporterEvents'] {
    const events: BufferedReporterEvent[] = [];

    return {
        [Symbol.iterator]() {
            return events[Symbol.iterator]();
        },
        clear() {
            events.length = 0;
        },
        push(...nextEvents) {
            events.push(...nextEvents);

            return events.length;
        }
    };
}

function portTransferList(port: NodeMessagePort): readonly NodeMessagePort[] {
    return [ port ];
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

function createTaskRun(lease: WorkerPoolUnitLease, runtime: WorkerPoolRunRuntime): WorkerPoolTaskRun {
    return {
        bufferedReporterEvents: createReporterEventBuffer(),
        controller: new AbortController(),
        endedByParent: createStoredRunValue(false),
        includeArtifacts: createStoredRunValue(true),
        lane: lease.lane.id,
        leaseKind: lease.kind,
        reporterEventsBuffered: unitCanUseBufferedHedging(runtime, lease.unit),
        requeuePendingCases: createStoredRunValue(false),
        state: createSupervisedRunState(),
        startedCases: new Set(),
        timeout: createStoredRunValue<
            ReturnType<WorkerPoolRunRuntime['dependencies']['wallClock']['setTimeout']> | null
        >(null),
        traceUnit: lease.traceUnit,
        unit: lease.unit
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
        recordTaskCrash(activeTask, runtime, 'Worker-pool execution stopped.');
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

function takeHostRunnerErrors(runtime: WorkerPoolRunRuntime): HostRunnerErrors {
    return runtime.pool.takeHostRunnerErrors?.() ?? [];
}

function handleHostRunnerErrors(
    hostRunnerErrors: HostRunnerErrors,
    context: TaskFailureContext
): boolean {
    if (hostRunnerErrors.length === 0) {
        return false;
    }

    context.runtime.terminalFailure.write(true);
    context.runtime.runState.recordRunnerErrors(hostRunnerErrors);
    context.dispatcher.clear();
    markActiveTasksCrashed(context.runtime);

    return true;
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
    if (context.runtime.terminalFailure.read()) {
        return null;
    }

    if (taskRun.endedByParent.read()) {
        return handleParentEndedFailure(taskRun, context);
    }

    recordTaskCrash(taskRun, context.runtime, crashReason(error));

    return recordWorkerCrash(context.runtime, context.crashCount, context.dispatcher) ? null : pendingWorkUnit(taskRun);
}

async function recordCompletedTaskRun(
    taskRun: WorkerPoolTaskRun,
    lease: WorkerPoolUnitLease,
    context: TaskExecutionContext
): Promise<void> {
    const output = await runFileUnit(taskRun, context.runtime, lease.lane, context.startedAtMilliseconds);
    context.dispatcher.finish(lease, lease.kind === 'primary');

    if (!taskRun.reporterEventsBuffered) {
        context.runtime.taskResults.push(output.result);

        return;
    }

    await recordCompletedHedgedTaskRun(context.authorities, output.result, taskRun, context.runtime);
}

function recordFailedTaskRun(
    error: unknown,
    taskRun: WorkerPoolTaskRun,
    lease: WorkerPoolUnitLease,
    context: TaskExecutionContext
): void {
    if (handleHostRunnerErrors(takeHostRunnerErrors(context.runtime), context)) {
        context.dispatcher.finish(lease, taskRun.startedCases.size > 0);
        return;
    }

    const unit = handleTaskFailure(error, taskRun, context);

    context.dispatcher.finish(lease, lease.kind === 'primary' && taskRun.startedCases.size > 0);

    if (taskRun.reporterEventsBuffered && taskRun.endedByParent.read()) {
        recordCancelledHedgedTaskRun(context.authorities, taskRun, context.runtime);
    }

    if (unit !== null) {
        context.dispatcher.requeue({ traceUnit: taskRun.traceUnit, unit });
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
            const taskRun = createTaskRun(lease, context.runtime);
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
    const authorities: HedgedAuthorities = new Map();
    const crashCount = createStoredRunValue(0);
    const dispatcher = createWorkDispatcher(runtime, placementPlan);

    await Promise.all(
        placementPlan.lanes.map(async function runLoop(lane) {
            await runWorkerLoop({
                completedTaskRuns,
                authorities,
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
