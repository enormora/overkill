import {
    MessageChannel as NodeMessageChannel,
    type MessagePort as NodeMessagePort
} from 'node:worker_threads';
import { workIdentityKey } from '../engine/identity.ts';
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
    WorkerPoolLeaseMember,
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
    finishCompletedLease,
    finishFailedLease,
    handleWorkerMessage,
    recordTaskCrash,
    recordTaskPermissionFailure
} from './worker-pool-task-events.ts';

type WorkerPoolTaskChannel = {
    readonly close: () => void;
    readonly port: NodeMessagePort;
};

type CompletedTaskRuns = {
    readonly push: (taskRun: WorkerPoolTaskRun) => number;
};
type TaskTraceUnit = WorkerPoolTaskRun['members'][number]['traceUnit'];

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

function memberPaths(members: readonly WorkerPoolLeaseMember[]): readonly string[] {
    return Array.from(
        new Set(members.flatMap(function toPaths(member) {
            return unitPaths(member.unit);
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

function createBatchRunCommand(
    runtime: WorkerPoolRunRuntime,
    members: readonly [WorkerPoolLeaseMember, ...readonly WorkerPoolLeaseMember[]]
): WorkerPoolCommand {
    const [ first ] = members;

    return {
        ...createRunCommand(runtime, first.unit),
        paths: memberPaths(members)
    };
}

function isWorkerPoolRunOutput(value: unknown): value is WorkerPoolRunOutput {
    return value !== null &&
        typeof value === 'object' &&
        Object.hasOwn(value, 'results');
}

async function runWorkerTask(request: WorkerTaskRunRequest): Promise<WorkerPoolRunOutput> {
    const assignedWork = request.taskRun.members.flatMap(function toWork(member) {
        return member.unit.work;
    });
    const output: unknown = await request.runtime.pool.run({
        assignedUnits: request.taskRun.members.map(function toAssignedUnit(member) {
            return { traceUnit: member.traceUnit, work: member.unit.work };
        }),
        assignedWork,
        command: createBatchRunCommand(request.runtime, request.taskRun.members),
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
        activeTraceUnit: createStoredRunValue<TaskTraceUnit | null>(null),
        bufferedReporterEvents: createReporterEventBuffer(),
        controller: new AbortController(),
        endedByParent: createStoredRunValue(false),
        envelopeId: createStoredRunValue(lease.envelopeId),
        includeArtifacts: createStoredRunValue(true),
        lane: lease.lane.id,
        leaseKind: lease.kind,
        members: lease.members,
        reporterEventsBuffered: lease.members.length === 1 && unitCanUseBufferedHedging(runtime, lease.unit),
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

function pendingMember(member: WorkerPoolLeaseMember, taskRun: WorkerPoolTaskRun): WorkerPoolLeaseMember | null {
    const work = member.unit.work.filter(function caseHasNotStarted(item) {
        return !taskRun.startedCases.has(workIdentityKey(item));
    });
    const firstWork = work[0];

    return firstWork === undefined
        ? null
        : {
            traceUnit: member.traceUnit,
            unit: {
                ...member.unit,
                work: [ firstWork, ...work.slice(1) ]
            }
        };
}

function pendingMembers(taskRun: WorkerPoolTaskRun): readonly WorkerPoolLeaseMember[] {
    return taskRun.members.flatMap(function toPendingMember(member) {
        const pending = pendingMember(member, taskRun);

        return pending === null ? [] : [ pending ];
    });
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

function markActiveTasksCrashed(runtime: WorkerPoolRunRuntime, excludedTask: WorkerPoolTaskRun | null): void {
    const crashedTasks = Array.from(runtime.activeTasks).filter(function isIncludedTask(activeTask) {
        return activeTask !== excludedTask;
    });

    for (const activeTask of crashedTasks) {
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
    markActiveTasksCrashed(runtime, null);
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
    markActiveTasksCrashed(context.runtime, null);

    return true;
}

function handleParentEndedFailure(
    taskRun: WorkerPoolTaskRun,
    context: TaskFailureContext
): readonly WorkerPoolLeaseMember[] {
    if (!taskRun.requeuePendingCases.read()) {
        return [];
    }

    return recordWorkerCrash(context.runtime, context.crashCount, context.dispatcher) ? [] : pendingMembers(taskRun);
}

function handleTaskFailure(
    error: unknown,
    taskRun: WorkerPoolTaskRun,
    context: TaskFailureContext
): readonly WorkerPoolLeaseMember[] {
    if (context.runtime.terminalFailure.read()) {
        return [];
    }

    if (taskRun.endedByParent.read()) {
        return handleParentEndedFailure(taskRun, context);
    }

    if (
        recordTaskPermissionFailure(error, taskRun, {
            dispatcher: context.dispatcher,
            runtime: context.runtime,
            stopActiveTasks(excludedTask) {
                markActiveTasksCrashed(context.runtime, excludedTask);
            }
        })
    ) {
        return [];
    }

    recordTaskCrash(taskRun, context.runtime, crashReason(error));

    return recordWorkerCrash(context.runtime, context.crashCount, context.dispatcher) ? [] : pendingMembers(taskRun);
}

function batchTraceUnits(taskRun: WorkerPoolTaskRun): readonly [TaskTraceUnit, ...TaskTraceUnit[]] {
    const [ first, ...rest ] = taskRun.members;

    return [
        first.traceUnit,
        ...rest.map(function toTraceUnit(member) {
            return member.traceUnit;
        })
    ];
}

function recordBatchStarted(taskRun: WorkerPoolTaskRun, runtime: WorkerPoolRunRuntime): void {
    const envelopeId = taskRun.envelopeId.read();

    if (envelopeId !== null) {
        runtime.recordPlacementTraceEntry({
            envelopeId,
            kind: 'batch-started',
            lane: taskRun.lane,
            units: batchTraceUnits(taskRun),
            workerId: taskRun.lane
        });
    }
}

function recordBatchCompleted(taskRun: WorkerPoolTaskRun, runtime: WorkerPoolRunRuntime): void {
    const envelopeId = taskRun.envelopeId.read();

    if (envelopeId !== null) {
        runtime.recordPlacementTraceEntry({
            envelopeId,
            kind: 'batch-completed',
            lane: taskRun.lane,
            units: batchTraceUnits(taskRun),
            workerId: taskRun.lane
        });
    }
}

async function recordCompletedTaskRun(
    taskRun: WorkerPoolTaskRun,
    lease: WorkerPoolUnitLease,
    context: TaskExecutionContext
): Promise<void> {
    recordBatchStarted(taskRun, context.runtime);
    const output = await runFileUnit(taskRun, context.runtime, lease.lane, context.startedAtMilliseconds);
    recordBatchCompleted(taskRun, context.runtime);
    finishCompletedLease(context.dispatcher, lease);

    if (!taskRun.reporterEventsBuffered) {
        context.runtime.taskResults.push(...output.results.map(function toResult(result) {
            return result.result;
        }));

        return;
    }

    const firstResult = output.results[0]?.result;

    if (firstResult !== undefined) {
        await recordCompletedHedgedTaskRun(context.authorities, firstResult, taskRun, context.runtime);
    }
}

function finishAfterHostRunnerErrors(
    taskRun: WorkerPoolTaskRun,
    lease: WorkerPoolUnitLease,
    context: TaskExecutionContext
): boolean {
    if (!handleHostRunnerErrors(takeHostRunnerErrors(context.runtime), context)) {
        return false;
    }

    finishFailedLease(context.dispatcher, taskRun, lease);

    return true;
}

function recordCancelledTaskRun(taskRun: WorkerPoolTaskRun, context: TaskExecutionContext): void {
    if (taskRun.reporterEventsBuffered && taskRun.endedByParent.read()) {
        recordCancelledHedgedTaskRun(context.authorities, taskRun, context.runtime);
    }
}

function recordFailedTaskRun(
    error: unknown,
    taskRun: WorkerPoolTaskRun,
    lease: WorkerPoolUnitLease,
    context: TaskExecutionContext
): void {
    if (finishAfterHostRunnerErrors(taskRun, lease, context)) {
        return;
    }

    const pending = handleTaskFailure(error, taskRun, context);

    finishFailedLease(context.dispatcher, taskRun, lease);
    recordCancelledTaskRun(taskRun, context);

    for (const member of pending) {
        context.dispatcher.requeue({ traceUnit: member.traceUnit, unit: member.unit });
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
