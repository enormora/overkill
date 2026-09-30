import type { MessagePort as NodeMessagePort } from 'node:worker_threads';
import {
    createStoredRunValue,
    createSupervisedRunState,
    type StoredRunValue
} from './supervised-run-state.ts';
import {
    createWorkerPoolMessageChannel,
    type WorkerPoolMessageChannel,
    type WorkerPoolRunOutput
} from './worker-pool-protocol.ts';
import {
    workerPoolPlacementTrace,
    type WorkerPoolRunRuntime,
    type WorkerPoolTaskRun
} from './worker-pool-runtime.ts';
import type {
    PlacementPlan,
    PlacementLane
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
    recordPlacementRecoveryDecisions,
    recordTaskCrash,
    recordTaskPermissionFailure,
    stopWorkerPoolTasks
} from './worker-pool-task-events.ts';
import {
    acquireWorkerPoolResourceLifecycle,
    completeWorkerPoolResourceMembers,
    createWorkerPoolBatchRunCommand,
    disposeWorkerPoolResourceLifecycles,
    workerPoolProjectedResourcesForWork,
    workerPoolWorkHasStarted,
    type WorkerPoolResourceLifecycle
} from './worker-pool-resource-lifecycle-execution.ts';

type CompletedTaskRuns = {
    readonly push: (taskRun: WorkerPoolTaskRun) => number;
};
type TaskAttempt = WorkerPoolTaskRun['members'][number]['attempt'];

type TaskFailureContext = {
    readonly crashCount: StoredRunValue<number>;
    readonly dispatcher: WorkerPoolWorkDispatcher;
    readonly runtime: WorkerPoolRunRuntime;
};

type TaskExecutionContext = TaskFailureContext & {
    readonly authorities: HedgedAuthorities;
    readonly resourceLifecycle: WorkerPoolResourceLifecycle;
    readonly startedAtMilliseconds: number;
};

type WorkerLoopContext = TaskExecutionContext & {
    readonly completedTaskRuns: CompletedTaskRuns;
    readonly lane: PlacementLane;
};

type WorkerTaskRunRequest = {
    readonly channel: WorkerPoolMessageChannel;
    readonly lane: PlacementLane;
    readonly resourceLifecycle: WorkerPoolResourceLifecycle;
    readonly runtime: WorkerPoolRunRuntime;
    readonly startedAtMilliseconds: number;
    readonly taskRun: WorkerPoolTaskRun;
};

type FileUnitRunRequest = {
    readonly lane: PlacementLane;
    readonly resourceLifecycle: WorkerPoolResourceLifecycle;
    readonly runtime: WorkerPoolRunRuntime;
    readonly startedAtMilliseconds: number;
    readonly taskRun: WorkerPoolTaskRun;
};

type WorkerPoolExecutionContext = {
    readonly authorities: HedgedAuthorities;
    readonly completedTaskRuns: CompletedTaskRuns;
    readonly crashCount: StoredRunValue<number>;
    readonly dispatcher: WorkerPoolWorkDispatcher;
    readonly placementPlan: PlacementPlan;
    readonly resourceLifecycle: WorkerPoolResourceLifecycle;
    readonly runtime: WorkerPoolRunRuntime;
    readonly startedAtMilliseconds: number;
};

type CreatedWorkerPoolExecutionContext = {
    readonly completedTaskRuns: readonly WorkerPoolTaskRun[];
    readonly context: WorkerPoolExecutionContext;
};

type HostRunnerErrors = ReturnType<NonNullable<WorkerPoolRunRuntime['pool']['takeHostRunnerErrors']>>;

const maximumCrashCount = 3;
const runtimePolicyStopMessage = 'Worker-pool execution stopped by runtime policy.';

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

function observeTaskMessages(taskRun: WorkerPoolTaskRun, runtime: WorkerPoolRunRuntime): WorkerPoolMessageChannel {
    return createWorkerPoolMessageChannel(function receiveWorkerMessage(message) {
        handleWorkerMessage(message, taskRun, runtime);
    });
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
            return { attempt: member.attempt, traceUnit: member.traceUnit, work: member.unit.work };
        }),
        assignedWork,
        boundaryUseCounts: [],
        command: createWorkerPoolBatchRunCommand(request.runtime, request.taskRun.members),
        kind: 'run',
        lane: request.lane.id,
        lifecycle: request.runtime.lifecycle,
        port: request.channel.port,
        projectedResources: workerPoolProjectedResourcesForWork(request.resourceLifecycle, assignedWork),
        runWork: request.resourceLifecycle.runWork,
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

async function runFileUnit(request: FileUnitRunRequest): Promise<WorkerPoolRunOutput> {
    const channel = observeTaskMessages(request.taskRun, request.runtime);

    try {
        const output = await runWorkerTask({ ...request, channel });

        await channel.messagesCompleted;

        return output;
    } finally {
        channel.close();
    }
}

function createTaskRun(lease: WorkerPoolUnitLease, runtime: WorkerPoolRunRuntime): WorkerPoolTaskRun {
    return {
        activeAttempt: createStoredRunValue<TaskAttempt | null>(null),
        bufferedReporterEvents: createReporterEventBuffer(),
        completedAttempts: new Set(),
        controller: new AbortController(),
        endedByParent: createStoredRunValue(false),
        envelopeId: createStoredRunValue(lease.envelopeId),
        includeArtifacts: createStoredRunValue(true),
        interruptionCause: createStoredRunValue<
            ReturnType<WorkerPoolTaskRun['interruptionCause']['read']>
        >(null),
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
        unit: lease.unit,
        workerId: createStoredRunValue<ReturnType<WorkerPoolTaskRun['workerId']['read']>>(null)
    };
}

function pendingMember(member: WorkerPoolLeaseMember, taskRun: WorkerPoolTaskRun): WorkerPoolLeaseMember | null {
    const work = member.unit.work.filter(function caseHasNotStarted(item) {
        return !workerPoolWorkHasStarted(taskRun.startedCases, item);
    });
    const firstWork = work[0];

    return firstWork === undefined
        ? null
        : {
            attempt: member.attempt,
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

function recordRunCrash(runtime: WorkerPoolRunRuntime, message: string, cause: unknown): void {
    runtime.runState.recordRunnerError({
        attributedTo: null,
        attributedToWork: null,
        cause,
        diagnostics: [],
        message,
        subtype: 'crash'
    });
}

function stopAfterCrashLimit(
    runtime: WorkerPoolRunRuntime,
    dispatcher: WorkerPoolWorkDispatcher,
    crashCount: number
): void {
    runtime.terminalFailure.write(true);
    recordRunCrash(runtime, 'Worker-pool stopped after 3 worker crashes.', { crashCount });
    dispatcher.clear();
    stopWorkerPoolTasks(runtime, null, 'run-stopped', 'Worker-pool execution stopped.');
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
    stopWorkerPoolTasks(context.runtime, null, 'host-failure', 'Worker-pool host failed.');

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
                stopWorkerPoolTasks(context.runtime, excludedTask, 'runtime-policy', runtimePolicyStopMessage);
            }
        })
    ) {
        return [];
    }

    recordTaskCrash(taskRun, context.runtime, 'worker-crash', error instanceof Error ? error.message : String(error));

    return recordWorkerCrash(context.runtime, context.crashCount, context.dispatcher) ? [] : pendingMembers(taskRun);
}

function batchAttempts(taskRun: WorkerPoolTaskRun): readonly [TaskAttempt, ...TaskAttempt[]] {
    const [ first, ...rest ] = taskRun.members;

    return [
        first.attempt,
        ...rest.map(function toAttempt(member) {
            return member.attempt;
        })
    ];
}

function recordBatchStarted(taskRun: WorkerPoolTaskRun, runtime: WorkerPoolRunRuntime): void {
    const envelopeId = taskRun.envelopeId.read();

    if (envelopeId !== null) {
        workerPoolPlacementTrace(runtime).recordDecision({
            attempts: batchAttempts(taskRun),
            envelopeId,
            kind: 'batch-started',
            lane: taskRun.lane
        });
    }
}

function recordBatchCompleted(taskRun: WorkerPoolTaskRun, runtime: WorkerPoolRunRuntime): void {
    const envelopeId = taskRun.envelopeId.read();

    if (envelopeId !== null) {
        workerPoolPlacementTrace(runtime).recordDecision({
            attempts: batchAttempts(taskRun),
            envelopeId,
            kind: 'batch-completed',
            lane: taskRun.lane
        });
    }
}

async function recordCompletedTaskRun(
    taskRun: WorkerPoolTaskRun,
    lease: WorkerPoolUnitLease,
    context: TaskExecutionContext
): Promise<void> {
    recordBatchStarted(taskRun, context.runtime);
    const output = await runFileUnit({
        taskRun,
        lane: lease.lane,
        resourceLifecycle: context.resourceLifecycle,
        runtime: context.runtime,
        startedAtMilliseconds: context.startedAtMilliseconds
    });
    recordBatchCompleted(taskRun, context.runtime);
    finishCompletedLease(context.dispatcher, lease);

    if (taskRun.reporterEventsBuffered) {
        const firstResult = output.results[0]?.result;

        if (firstResult !== undefined) {
            await recordCompletedHedgedTaskRun(context.authorities, firstResult, taskRun, context.runtime);
        }
    } else {
        context.runtime.taskResults.push(...output.results.map(function toResult(result) {
            return result.result;
        }));
        await completeWorkerPoolResourceMembers(context.runtime, context.resourceLifecycle, taskRun.members);
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

function recordTaskRecovery(
    taskRun: WorkerPoolTaskRun,
    pending: readonly WorkerPoolLeaseMember[],
    runtime: WorkerPoolRunRuntime
): void {
    const cause = taskRun.interruptionCause.read();

    if (cause !== null) {
        recordPlacementRecoveryDecisions(taskRun, pending, runtime, cause);
    }
}

function recordFailedTaskRun(
    error: unknown,
    taskRun: WorkerPoolTaskRun,
    lease: WorkerPoolUnitLease,
    context: TaskExecutionContext
): void {
    if (finishAfterHostRunnerErrors(taskRun, lease, context)) {
        recordTaskRecovery(taskRun, [], context.runtime);
        return;
    }

    const pending = handleTaskFailure(error, taskRun, context);
    recordTaskRecovery(taskRun, pending, context.runtime);

    finishFailedLease(context.dispatcher, taskRun, lease);
    recordCancelledTaskRun(taskRun, context);

    for (const member of pending) {
        context.dispatcher.requeue({
            previousAttempt: member.attempt,
            traceUnit: member.traceUnit,
            unit: member.unit
        });
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

async function createWorkerPoolExecutionContext(
    runtime: WorkerPoolRunRuntime,
    placementPlan: PlacementPlan,
    startedAtMilliseconds: number
): Promise<CreatedWorkerPoolExecutionContext> {
    const completedTaskRuns: WorkerPoolTaskRun[] = [];
    const resourceLifecycle = await acquireWorkerPoolResourceLifecycle(runtime, placementPlan);

    return {
        completedTaskRuns,
        context: {
            authorities: new Map(),
            completedTaskRuns,
            crashCount: createStoredRunValue(0),
            dispatcher: createWorkDispatcher(runtime, placementPlan),
            placementPlan,
            resourceLifecycle,
            runtime,
            startedAtMilliseconds
        }
    };
}

async function runPlacementLanes(context: WorkerPoolExecutionContext): Promise<void> {
    await Promise.all(
        context.placementPlan.lanes.map(async function runLoop(lane) {
            await runWorkerLoop({ ...context, lane });
        })
    );
}

async function runPlacementLanesWhenActive(context: WorkerPoolExecutionContext): Promise<void> {
    if (!context.runtime.terminalFailure.read()) {
        await runPlacementLanes(context);
    }
}

export async function executeWorkerPoolUnits(
    runtime: WorkerPoolRunRuntime,
    placementPlan: PlacementPlan,
    startedAtMilliseconds: number
): Promise<readonly WorkerPoolTaskRun[]> {
    const { completedTaskRuns, context } = await createWorkerPoolExecutionContext(
        runtime,
        placementPlan,
        startedAtMilliseconds
    );

    try {
        await runPlacementLanesWhenActive(context);
    } finally {
        await disposeWorkerPoolResourceLifecycles(runtime, placementPlan, context.resourceLifecycle);
    }

    return completedTaskRuns;
}
