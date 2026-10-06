import { createDefaultWorkId, workIdentityKey, type WorkId } from '../engine/identity.ts';
import { permissionDeniedRunnerErrorFromThrown, type RunnerError } from '../engine/run-result.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import { applyEvent } from './supervised-run-runtime.ts';
import {
    remainingHardTimeoutMilliseconds,
    type SupervisedCase,
    type ActiveSupervisedCase
} from './supervised-run-state.ts';
import { crashError } from './supervised-run-resource-policy.ts';
import type { PlacementRecoveryDecision } from './placement-trace.ts';
import type { WorkerPoolMessage } from './worker-pool-protocol.ts';
import {
    workerPoolPlacementTrace,
    type WorkerPoolRunRuntime,
    type WorkerPoolTaskRun
} from './worker-pool-runtime.ts';
import type {
    WorkerPoolLeaseMember,
    WorkerPoolUnitLease,
    WorkerPoolWorkDispatcher
} from './worker-pool-dispatch-state.ts';

type RuntimeReporterEvent = Parameters<WorkerPoolRunRuntime['reporterDelivery']['reportEvent']>[0];
type PlacementAttemptInterruptionCause = NonNullable<
    ReturnType<WorkerPoolTaskRun['interruptionCause']['read']>
>;
type WorkerPoolPermissionFailureContext = {
    readonly dispatcher: WorkerPoolWorkDispatcher;
    readonly runtime: WorkerPoolRunRuntime;
    readonly stopActiveTasks: (excludedTask: WorkerPoolTaskRun | null) => void;
};

function memberUnits(taskRun: WorkerPoolTaskRun): readonly WorkerPoolTaskRun['unit'][] {
    return taskRun.members.map(function toUnit(member) {
        return member.unit;
    });
}

function taskRunKeepsLeaseReservation(taskRun: WorkerPoolTaskRun, lease: WorkerPoolUnitLease): boolean {
    return lease.kind === 'primary' && taskRun.startedCases.size > 0;
}

export function finishCompletedLease(dispatcher: WorkerPoolWorkDispatcher, lease: WorkerPoolUnitLease): void {
    dispatcher.finish(lease, {
        learnWarmth: lease.kind === 'primary',
        retainReservation: lease.kind === 'primary',
        workerCrashed: false
    });
}

export function finishFailedLease(
    dispatcher: WorkerPoolWorkDispatcher,
    taskRun: WorkerPoolTaskRun,
    lease: WorkerPoolUnitLease
): void {
    dispatcher.finish(lease, {
        learnWarmth: false,
        retainReservation: taskRunKeepsLeaseReservation(taskRun, lease),
        workerCrashed: true
    });
}

function casesByKey(taskRun: WorkerPoolTaskRun): ReadonlyMap<string, SupervisedCase> {
    return new Map(
        memberUnits(taskRun).flatMap(function toUnitCases(unit) {
            return unit.work.map(function toCaseEntry(work) {
                return [ workIdentityKey(work), { capture: null, id: work.case, workId: work } ] as const;
            });
        })
    );
}

function singleActiveCase(taskRun: WorkerPoolTaskRun): ActiveSupervisedCase | null {
    const activeCases = Array.from(taskRun.state.activeCases.values());
    const [ activeCase ] = activeCases;

    return activeCases.length === 1 && activeCase !== undefined ? activeCase : null;
}

function attributedWork(activeCase: SupervisedCase | null): WorkId | null {
    return activeCase === null ? null : activeCase.workId ?? createDefaultWorkId(activeCase.id);
}

function nonEmptyWork(work: readonly WorkId[]): readonly [WorkId, ...readonly WorkId[]] | null {
    const [ first, ...remaining ] = work;

    return first === undefined ? null : [ first, ...remaining ];
}

function abandonedWork(
    member: WorkerPoolTaskRun['members'][number],
    retryWork: readonly WorkId[] | null
): readonly [WorkId, ...readonly WorkId[]] | null {
    const retryKeys = new Set(retryWork?.map(workIdentityKey));

    return nonEmptyWork(member.unit.work.filter(function wasNotRetried(work) {
        return !retryKeys.has(workIdentityKey(work));
    }));
}

function abandonmentDecision(
    work: readonly [WorkId, ...readonly WorkId[]] | null
): PlacementRecoveryDecision {
    if (work === null) {
        throw new Error('Interrupted placement attempt has no recovery work.');
    }

    return { abandonedWork: work, kind: 'abandon' };
}

function recoveryDecision(
    member: WorkerPoolTaskRun['members'][number],
    pending: readonly WorkerPoolLeaseMember[]
): PlacementRecoveryDecision {
    const pendingMember = pending.find(function matchesAttempt(candidate) {
        return candidate.attempt === member.attempt;
    });
    const retryWork = pendingMember === undefined ? null : nonEmptyWork(pendingMember.unit.work);
    const abandoned = abandonedWork(member, retryWork);

    if (retryWork === null) {
        return abandonmentDecision(abandoned);
    }

    return abandoned === null
        ? { kind: 'retry', retryWork }
        : { abandonedWork: abandoned, kind: 'partial', retryWork };
}

export function recordPlacementRecoveryDecisions(
    taskRun: WorkerPoolTaskRun,
    pending: readonly WorkerPoolLeaseMember[],
    runtime: WorkerPoolRunRuntime,
    cause: PlacementAttemptInterruptionCause
): void {
    const interruptedMembers = taskRun.members.filter(function wasInterrupted(member) {
        return !taskRun.completedAttempts.has(member.attempt);
    });

    for (const member of interruptedMembers) {
        workerPoolPlacementTrace(runtime).decideRecovery(
            member.attempt,
            cause,
            recoveryDecision(member, pending)
        );
    }
}

function interruptTaskAttempts(
    taskRun: WorkerPoolTaskRun,
    runtime: WorkerPoolRunRuntime,
    cause: PlacementAttemptInterruptionCause
): void {
    const incompleteMembers = taskRun.members.filter(function isIncomplete(member) {
        return !taskRun.completedAttempts.has(member.attempt);
    });

    for (const member of incompleteMembers) {
        workerPoolPlacementTrace(runtime).interruptAttempt(member.attempt, cause);
    }
}

function recordPermissionFailure(
    runnerError: RunnerError,
    taskRun: WorkerPoolTaskRun,
    context: WorkerPoolPermissionFailureContext
): void {
    taskRun.interruptionCause.write('runtime-policy');
    interruptTaskAttempts(taskRun, context.runtime, 'runtime-policy');
    taskRun.endedByParent.write(true);
    taskRun.requeuePendingCases.write(false);
    taskRun.state.recordRunnerError(runnerError);
    taskRun.state.recordTerminalActiveCases(
        'runtime-policy',
        Number(context.runtime.dependencies.wallClock.currentMonotonicMicroseconds)
    );
    context.runtime.terminalFailure.write(true);
    context.dispatcher.clear();
    context.stopActiveTasks(taskRun);
}

function activeAttempt(activeCase: ActiveSupervisedCase | null): RunnerError['attributedToAttempt'] {
    return activeCase === null ? null : activeCase.attempt;
}

export function recordTaskPermissionFailure(
    error: unknown,
    taskRun: WorkerPoolTaskRun,
    context: WorkerPoolPermissionFailureContext
): boolean {
    const activeCase = singleActiveCase(taskRun);
    const runnerError = permissionDeniedRunnerErrorFromThrown(error, {
        attributedTo: activeCase?.id ?? null,
        attributedToWork: attributedWork(activeCase),
        boundary: 'worker-pool-worker',
        diagnosticChannel: null,
        hook: null,
        phase: activeCase === null ? 'run' : 'body'
    });

    if (runnerError === null) {
        return false;
    }

    recordPermissionFailure({ ...runnerError, attributedToAttempt: activeAttempt(activeCase) }, taskRun, context);

    return true;
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

export function clearTaskTimeout(
    taskRun: WorkerPoolTaskRun,
    dependencies: RunOrchestratorDependencies
): void {
    const timeout = taskRun.timeout.read();

    if (timeout !== null) {
        dependencies.wallClock.clearTimeout(timeout);
        taskRun.timeout.write(null);
    }
}

function recordWorkerCrashTrace(taskRun: WorkerPoolTaskRun, runtime: WorkerPoolRunRuntime): void {
    workerPoolPlacementTrace(runtime).recordDecision({
        activeAttempt: taskRun.activeAttempt.read(),
        kind: 'worker-crashed',
        lane: taskRun.lane,
        workerId: taskRun.workerId.read()
    });
}

export function recordTaskCrash(
    taskRun: WorkerPoolTaskRun,
    runtime: WorkerPoolRunRuntime,
    cause: PlacementAttemptInterruptionCause,
    message: string
): void {
    if (taskRun.interruptionCause.read() !== null) {
        return;
    }
    taskRun.interruptionCause.write(cause);
    interruptTaskAttempts(taskRun, runtime, cause);
    recordWorkerCrashTrace(taskRun, runtime);
    taskRun.state.recordRunnerError(crashError(taskRun.state, message));
    taskRun.state.recordTerminalActiveCases(
        'crashed',
        Number(runtime.dependencies.wallClock.currentMonotonicMicroseconds)
    );
}

export function stopWorkerPoolTasks(
    runtime: WorkerPoolRunRuntime,
    excludedTask: WorkerPoolTaskRun | null,
    cause: PlacementAttemptInterruptionCause,
    message: string
): void {
    const stoppedTasks = Array.from(runtime.activeTasks).filter(function isIncludedTask(activeTask) {
        return activeTask !== excludedTask;
    });

    for (const activeTask of stoppedTasks) {
        activeTask.endedByParent.write(true);
        activeTask.requeuePendingCases.write(false);
        recordTaskCrash(activeTask, runtime, cause, message);
        clearTaskTimeout(activeTask, runtime.dependencies);
        activeTask.controller.abort();
    }
}

function startTaskTimeout(taskRun: WorkerPoolTaskRun, runtime: WorkerPoolRunRuntime): void {
    clearTaskTimeout(taskRun, runtime.dependencies);

    const remainingMilliseconds = remainingHardTimeoutMilliseconds(
        taskRun.state.activeCases.values(),
        Number(runtime.dependencies.wallClock.currentMonotonicMicroseconds),
        runtime.resolvedRun.facts.execution.timeoutPolicy.hardMilliseconds
    );

    if (remainingMilliseconds === null) {
        return;
    }

    taskRun.timeout.write(runtime.dependencies.wallClock.setTimeout(function abortTimedOutWorker() {
        taskRun.endedByParent.write(true);
        taskRun.requeuePendingCases.write(true);
        recordTaskCrash(taskRun, runtime, 'hard-timeout', 'Worker-pool work unit exceeded hard timeout.');
        taskRun.controller.abort();
    }, remainingMilliseconds));
}

function eventWithTaskArtifacts(
    event: RuntimeReporterEvent,
    taskRun: WorkerPoolTaskRun,
    runtime: WorkerPoolRunRuntime
): RuntimeReporterEvent {
    return event.kind === 'test-end'
        ? {
            ...event,
            artifacts: [
                ...event.artifacts,
                ...runtime.attachments?.caseArtifacts(event.workId ?? createDefaultWorkId(event.case), {
                    index: event.attempt
                }, taskRun) ?? [],
                ...taskRun.state.caseArtifacts(event.workId ?? createDefaultWorkId(event.case), {
                    index: event.attempt
                })
            ]
        }
        : event;
}

function handleWorkerEvent(
    event: RuntimeReporterEvent,
    taskRun: WorkerPoolTaskRun,
    runtime: WorkerPoolRunRuntime
): void {
    if (event.kind === 'test-start') {
        taskRun.startedCases.add(workIdentityKey(event.workId ?? createDefaultWorkId(event.case)));
    }

    const reportedEvent = eventWithTaskArtifacts(event, taskRun, runtime);

    applyEvent(
        reportedEvent,
        taskRun.state,
        casesByKey(taskRun),
        Number(runtime.dependencies.wallClock.currentMonotonicMicroseconds)
    );

    if (reportedEvent.kind === 'test-start' || reportedEvent.kind === 'test-end') {
        startTaskTimeout(taskRun, runtime);
    }

    if (taskRun.reporterEventsBuffered) {
        taskRun.bufferedReporterEvents.push(reportedEvent);
    } else {
        runtime.reporterEvents.add(recordReporterEventErrors(reportedEvent, runtime));
    }
}

function handleUnitStarted(
    message: Extract<WorkerPoolMessage, { readonly kind: 'attempt-started'; }>,
    taskRun: WorkerPoolTaskRun,
    runtime: WorkerPoolRunRuntime
): void {
    taskRun.activeAttempt.write(message.attempt);
    taskRun.workerId.write(message.workerId);
    workerPoolPlacementTrace(runtime).startAttempt(message.attempt, message.workerId);
}

function handleUnitCompleted(
    message: Extract<WorkerPoolMessage, { readonly kind: 'attempt-completed'; }>,
    taskRun: WorkerPoolTaskRun,
    runtime: WorkerPoolRunRuntime
): void {
    workerPoolPlacementTrace(runtime).completeAttempt(message.attempt, message.durationMicroseconds);
    taskRun.completedAttempts.add(message.attempt);
    if (taskRun.activeAttempt.read() === message.attempt) {
        taskRun.activeAttempt.write(null);
    }
}

function handleTaskMessage(
    message: Exclude<WorkerPoolMessage, { readonly kind: 'task-messages-completed'; }>,
    taskRun: WorkerPoolTaskRun,
    runtime: WorkerPoolRunRuntime
): void {
    if (message.kind === 'output') {
        taskRun.state.recordCapturedOutput(
            message.stream,
            Buffer.from(message.chunk),
            message.capturedAtMicroseconds
        );
    } else if (message.kind === 'attempt-started') {
        handleUnitStarted(message, taskRun, runtime);
    } else if (message.kind === 'attempt-completed') {
        handleUnitCompleted(message, taskRun, runtime);
    } else if (message.kind === 'timing') {
        runtime.timing?.recordLocal(message.span);
    } else {
        handleWorkerEvent(message.event, taskRun, runtime);
    }
}

export function handleWorkerMessage(
    message: WorkerPoolMessage,
    taskRun: WorkerPoolTaskRun,
    runtime: WorkerPoolRunRuntime
): void {
    if (message.kind !== 'task-messages-completed') {
        handleTaskMessage(message, taskRun, runtime);
    }
}
