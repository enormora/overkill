import {
    MessageChannel as NodeMessageChannel,
    type MessagePort as NodeMessagePort
} from 'node:worker_threads';
import { caseIdentityKey } from '../engine/identity.ts';
import type {
    ReporterEvent,
    ResourceUsageSnapshot
} from '../packages/engine/engine.entry-point.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import {
    applyEvent
} from './supervised-run-runtime.ts';
import {
    createStoredRunValue,
    createSupervisedRunState,
    type StoredRunValue,
    type SupervisedCase,
    type SupervisedRunState
} from './supervised-run-state.ts';
import {
    crashError,
    findResourceBudgetBreach,
    resourceExhaustionError
} from './supervised-run-resource-policy.ts';
import type {
    WorkerPoolCommand,
    WorkerPoolMessage,
    WorkerPoolRunOutput
} from './worker-pool-protocol.ts';
import {
    runStartTimeFromMilliseconds,
    workerPoolExecutionFacts,
    type WorkerPoolRunRuntime,
    type WorkerPoolTaskRun
} from './worker-pool-runtime.ts';
import type {
    PlacementPlan,
    PlacementLane,
    WorkUnit,
    WorkId
} from './run-types.ts';

type WorkerPoolTaskChannel = {
    readonly close: () => void;
    readonly port: NodeMessagePort;
};

type WorkerPoolUnitQueue = {
    readonly clear: () => void;
    readonly pull: () => WorkUnit | null;
    readonly requeue: (unit: WorkUnit) => void;
};

type CompletedTaskRuns = {
    readonly push: (taskRun: WorkerPoolTaskRun) => number;
};

type TaskFailureContext = {
    readonly crashCount: StoredRunValue<number>;
    readonly queue: WorkerPoolUnitQueue;
    readonly runtime: WorkerPoolRunRuntime;
};

type TaskExecutionContext = TaskFailureContext & {
    readonly startedAtMilliseconds: number;
};

type WorkerLoopContext = TaskExecutionContext & {
    readonly completedTaskRuns: CompletedTaskRuns;
};

const maximumCrashCount = 3;

function portTransferList(port: NodeMessagePort): readonly NodeMessagePort[] {
    return [ port ];
}

function casesByKey(unit: WorkUnit): ReadonlyMap<string, SupervisedCase> {
    return new Map(
        unit.work.map(function toCaseEntry(work) {
            return [ caseIdentityKey(work.case), { capture: null, id: work.case } ];
        })
    );
}

async function recordReporterEventErrors(
    event: ReporterEvent,
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
        taskRun.state.recordTerminalActiveCases('crashed');
        taskRun.controller.abort();
    }, runtime.resolvedRun.facts.execution.timeoutPolicy.hardMilliseconds));
}

function handleWorkerEvent(
    event: ReporterEvent,
    taskRun: WorkerPoolTaskRun,
    runtime: WorkerPoolRunRuntime
): void {
    if (event.kind === 'test-start') {
        taskRun.startedCases.add(caseIdentityKey(event.case));
        startTaskTimeout(taskRun, runtime);
    }

    const reportedEvent: ReporterEvent = event.kind === 'test-end'
        ? {
            ...event,
            artifacts: [
                ...event.artifacts,
                ...taskRun.state.caseArtifacts(event.case)
            ]
        }
        : event;

    applyEvent(reportedEvent, taskRun.state, casesByKey(taskRun.unit));

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

async function runWorkerTask(
    taskRun: WorkerPoolTaskRun,
    runtime: WorkerPoolRunRuntime,
    channel: WorkerPoolTaskChannel,
    startedAtMilliseconds: number
): Promise<WorkerPoolRunOutput> {
    const output: unknown = await runtime.pool.run({
        assignedWork: taskRun.unit.work,
        command: createRunCommand(runtime, taskRun.unit),
        kind: 'run',
        port: channel.port,
        startedAtMilliseconds
    }, {
        name: 'runTask',
        signal: taskRun.controller.signal,
        transferList: portTransferList(channel.port)
    });

    if (!isWorkerPoolRunOutput(output)) {
        throw new Error('Worker-pool task returned an invalid result.');
    }

    return output;
}

async function runFileUnit(
    taskRun: WorkerPoolTaskRun,
    runtime: WorkerPoolRunRuntime,
    startedAtMilliseconds: number
): Promise<WorkerPoolRunOutput> {
    const channel = observeTaskMessages(taskRun, runtime);

    try {
        return await runWorkerTask(taskRun, runtime, channel, startedAtMilliseconds);
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
        return !taskRun.startedCases.has(caseIdentityKey(work.case));
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
        activeTask.state.recordTerminalActiveCases('crashed');
        clearTaskTimeout(activeTask, runtime.dependencies);
        activeTask.controller.abort();
    }
}

function stopAfterCrashLimit(runtime: WorkerPoolRunRuntime, queue: WorkerPoolUnitQueue, crashCount: number): void {
    runtime.terminalFailure.write(true);
    recordRunCrash(runtime, 'Worker-pool stopped after 3 worker crashes.', { crashCount });
    queue.clear();
    markActiveTasksCrashed(runtime);
}

function recordWorkerCrash(
    runtime: WorkerPoolRunRuntime,
    crashCount: StoredRunValue<number>,
    queue: WorkerPoolUnitQueue
): boolean {
    const nextCrashCount = crashCount.read() + 1;
    crashCount.write(nextCrashCount);

    if (nextCrashCount >= maximumCrashCount) {
        stopAfterCrashLimit(runtime, queue, nextCrashCount);
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

    return recordWorkerCrash(context.runtime, context.crashCount, context.queue) ? null : pendingWorkUnit(taskRun);
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
    taskRun.state.recordTerminalActiveCases('crashed');

    return recordWorkerCrash(context.runtime, context.crashCount, context.queue) ? null : pendingWorkUnit(taskRun);
}

function createUnitQueue(units: readonly WorkUnit[]): WorkerPoolUnitQueue {
    const pendingUnits = Array.from(units);
    let nextIndex = 0;

    return {
        clear() {
            pendingUnits.length = 0;
            nextIndex = 0;
        },
        pull() {
            const unit = pendingUnits[nextIndex] ?? null;
            nextIndex += unit === null ? 0 : 1;

            return unit;
        },
        requeue(unit) {
            pendingUnits.push(unit);
        }
    };
}

async function executeTaskRun(
    taskRun: WorkerPoolTaskRun,
    context: TaskExecutionContext
): Promise<void> {
    context.runtime.activeTasks.add(taskRun);

    try {
        const output = await runFileUnit(taskRun, context.runtime, context.startedAtMilliseconds);
        context.runtime.taskResults.push(output.result);
    } catch (error: unknown) {
        const unit = handleTaskFailure(error, taskRun, context);

        if (unit !== null) {
            context.queue.requeue(unit);
        }
    } finally {
        clearTaskTimeout(taskRun, context.runtime.dependencies);
        context.runtime.activeTasks.delete(taskRun);
    }
}

async function runWorkerLoop(context: WorkerLoopContext): Promise<void> {
    while (!context.runtime.terminalFailure.read()) {
        const unit = context.queue.pull();

        if (unit === null) {
            return;
        }

        const taskRun = createTaskRun(unit);
        await executeTaskRun(taskRun, context);
        context.completedTaskRuns.push(taskRun);
    }
}

function unitByKey(units: readonly WorkUnit[]): ReadonlyMap<string, WorkUnit> {
    return new Map(units.map(function toEntry(unit) {
        return [ JSON.stringify(unit.id), unit ];
    }));
}

function unitsAssignedToLane(plan: PlacementPlan, lane: PlacementLane): readonly WorkUnit[] {
    const units = unitByKey(plan.units);

    return plan.assignments.flatMap(function toUnit(assignment) {
        const unit = units.get(JSON.stringify(assignment.unit));

        if (assignment.lane !== lane.id) {
            return [];
        }

        if (unit === undefined) {
            throw new Error('Placement assignment referenced an unknown work unit.');
        }

        return [ unit ];
    });
}

export async function executeWorkerPoolUnits(
    runtime: WorkerPoolRunRuntime,
    placementPlan: PlacementPlan,
    startedAtMilliseconds: number
): Promise<readonly WorkerPoolTaskRun[]> {
    const completedTaskRuns: WorkerPoolTaskRun[] = [];
    const crashCount = createStoredRunValue(0);

    await Promise.all(
        placementPlan.lanes.map(async function runLoop(lane) {
            await runWorkerLoop({
                completedTaskRuns,
                crashCount,
                queue: createUnitQueue(unitsAssignedToLane(placementPlan, lane)),
                runtime,
                startedAtMilliseconds
            });
        })
    );

    return completedTaskRuns;
}

function poolResourceBudgets(runtime: WorkerPoolRunRuntime): WorkerPoolCommand['resourceBudgets'] {
    const { budgets } = runtime.resolvedRun.facts.execution.resourceUsagePolicy;

    return {
        activeResourceCount: null,
        javaScriptEngineHeapBytes: null,
        residentSetBytes: budgets.residentSetBytes,
        residentSetGrowthBytesPerSecond: budgets.residentSetGrowthBytesPerSecond
    };
}

function createActiveCaseState(runtime: WorkerPoolRunRuntime): SupervisedRunState {
    const activeState = createSupervisedRunState();

    for (const taskRun of runtime.activeTasks) {
        for (const [ key, activeCase ] of taskRun.state.activeCases) {
            activeState.addActiveCase(key, activeCase);
        }
    }

    return activeState;
}

function stopTaskForResourceExhaustion(taskRun: WorkerPoolTaskRun, runtime: WorkerPoolRunRuntime): void {
    taskRun.endedByParent.write(true);
    taskRun.requeuePendingCases.write(false);
    taskRun.state.recordTerminalActiveCases('resource-exhausted');
    clearTaskTimeout(taskRun, runtime.dependencies);
    taskRun.controller.abort();
}

function stopActiveTasksForResourceExhaustion(runtime: WorkerPoolRunRuntime): void {
    for (const taskRun of runtime.activeTasks) {
        stopTaskForResourceExhaustion(taskRun, runtime);
    }
}

function recordPoolResourceBreach(runtime: WorkerPoolRunRuntime, sample: ResourceUsageSnapshot): void {
    const breach = findResourceBudgetBreach(
        poolResourceBudgets(runtime),
        sample,
        runtime.previousPoolSample.read()
    );
    runtime.previousPoolSample.write(sample);

    if (breach !== null) {
        runtime.terminalFailure.write(true);
        const activeState = createActiveCaseState(runtime);
        const error = resourceExhaustionError(breach, activeState);
        runtime.runState.recordRunnerError(error);
        runtime.reporterEvents.add(recordReporterEventErrors({ error, kind: 'runner-error' }, runtime));
        stopActiveTasksForResourceExhaustion(runtime);
    }
}

export async function startPoolResourceTracking(runtime: WorkerPoolRunRuntime): Promise<void> {
    runtime.poolResourceUsageTracker?.start(function recordPoolSample(sample) {
        if (!runtime.terminalFailure.read()) {
            recordPoolResourceBreach(runtime, sample);
        }
    });
    await runtime.poolResourceUsageTracker?.waitForStart?.();
}

export async function reportRunStart(
    runtime: WorkerPoolRunRuntime,
    startedAtMilliseconds: number
): Promise<void> {
    if (runtime.resolvedRun.facts.execution.placementPlan?.units.length === 0) {
        return;
    }

    await recordReporterEventErrors({
        facts: runtime.resolvedRun.facts,
        kind: 'run-start',
        root: {
            annotations: runtime.collectedPlan.root.annotations,
            title: runtime.collectedPlan.root.title
        },
        startedAt: runStartTimeFromMilliseconds(startedAtMilliseconds)
    }, runtime);
}
