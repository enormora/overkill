import { createDefaultWorkId, workIdentityKey, type WorkId } from '../engine/identity.ts';
import { permissionDeniedRunnerErrorFromThrown, type RunnerError } from '../engine/run-result.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import { applyEvent } from './supervised-run-runtime.ts';
import type { SupervisedCase } from './supervised-run-state.ts';
import { crashError } from './supervised-run-resource-policy.ts';
import type { WorkUnit } from './run-types.ts';
import type { WorkerPoolMessage } from './worker-pool-protocol.ts';
import type { WorkerPoolRunRuntime, WorkerPoolTaskRun } from './worker-pool-runtime.ts';
import type { WorkerPoolWorkDispatcher } from './worker-pool-dispatch-state.ts';

type RuntimeReporterEvent = Parameters<WorkerPoolRunRuntime['reporterDelivery']['reportEvent']>[0];
type WorkerPoolPermissionFailureContext = {
    readonly dispatcher: WorkerPoolWorkDispatcher;
    readonly runtime: WorkerPoolRunRuntime;
    readonly stopActiveTasks: (excludedTask: WorkerPoolTaskRun | null) => void;
};

function memberUnits(taskRun: WorkerPoolTaskRun): readonly WorkUnit[] {
    return taskRun.members.map(function toUnit(member) {
        return member.unit;
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

function singleActiveCase(taskRun: WorkerPoolTaskRun): SupervisedCase | null {
    const activeCases = Array.from(taskRun.state.activeCases.values());
    const [ activeCase ] = activeCases;

    return activeCases.length === 1 && activeCase !== undefined ? activeCase : null;
}

function attributedWork(activeCase: SupervisedCase | null): WorkId | null {
    return activeCase === null ? null : activeCase.workId ?? createDefaultWorkId(activeCase.id);
}

function recordPermissionFailure(
    runnerError: RunnerError,
    taskRun: WorkerPoolTaskRun,
    context: WorkerPoolPermissionFailureContext
): void {
    taskRun.endedByParent.write(true);
    taskRun.requeuePendingCases.write(false);
    taskRun.state.recordRunnerError(runnerError);
    taskRun.state.recordTerminalActiveCases(
        'runtime-policy',
        context.runtime.dependencies.wallClock.currentMonotonicMicroseconds
    );
    context.runtime.terminalFailure.write(true);
    context.dispatcher.clear();
    context.stopActiveTasks(taskRun);
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

    recordPermissionFailure(runnerError, taskRun, context);

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
    runtime.recordPlacementTraceEntry({
        activeUnit: taskRun.activeTraceUnit.read(),
        kind: 'worker-crashed',
        workerId: taskRun.lane
    });
}

export function recordTaskCrash(
    taskRun: WorkerPoolTaskRun,
    runtime: WorkerPoolRunRuntime,
    message: string
): void {
    recordWorkerCrashTrace(taskRun, runtime);
    taskRun.state.recordRunnerError(crashError(taskRun.state, message));
    taskRun.state.recordTerminalActiveCases(
        'crashed',
        runtime.dependencies.wallClock.currentMonotonicMicroseconds
    );
}

function startTaskTimeout(taskRun: WorkerPoolTaskRun, runtime: WorkerPoolRunRuntime): void {
    if (taskRun.timeout.read() !== null) {
        return;
    }

    taskRun.timeout.write(runtime.dependencies.wallClock.setTimeout(function abortTimedOutWorker() {
        taskRun.endedByParent.write(true);
        taskRun.requeuePendingCases.write(true);
        recordTaskCrash(taskRun, runtime, 'Worker-pool work unit exceeded hard timeout.');
        taskRun.controller.abort();
    }, runtime.resolvedRun.facts.execution.timeoutPolicy.hardMilliseconds));
}

function eventWithTaskArtifacts(
    event: RuntimeReporterEvent,
    taskRun: WorkerPoolTaskRun
): RuntimeReporterEvent {
    return event.kind === 'test-end'
        ? {
            ...event,
            artifacts: [
                ...event.artifacts,
                ...taskRun.state.caseArtifacts(event.case)
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
        startTaskTimeout(taskRun, runtime);
    }

    const reportedEvent = eventWithTaskArtifacts(event, taskRun);

    applyEvent(
        reportedEvent,
        taskRun.state,
        casesByKey(taskRun),
        runtime.dependencies.wallClock.currentMonotonicMicroseconds
    );

    if (reportedEvent.kind === 'test-end' && taskRun.state.activeCases.size === 0) {
        clearTaskTimeout(taskRun, runtime.dependencies);
    }

    if (taskRun.reporterEventsBuffered) {
        taskRun.bufferedReporterEvents.push(reportedEvent);
    } else {
        runtime.reporterEvents.add(recordReporterEventErrors(reportedEvent, runtime));
    }
}

function handleUnitStarted(
    message: Extract<WorkerPoolMessage, { readonly kind: 'unit-started'; }>,
    taskRun: WorkerPoolTaskRun,
    runtime: WorkerPoolRunRuntime
): void {
    taskRun.activeTraceUnit.write(message.traceUnit);
    runtime.recordPlacementTraceEntry({
        kind: 'unit-started',
        lane: taskRun.lane,
        unit: message.traceUnit,
        workerId: taskRun.lane
    });
}

function handleUnitCompleted(
    message: Extract<WorkerPoolMessage, { readonly kind: 'unit-completed'; }>,
    taskRun: WorkerPoolTaskRun,
    runtime: WorkerPoolRunRuntime
): void {
    runtime.recordPlacementTraceEntry({
        durationMicroseconds: message.durationMicroseconds,
        kind: 'unit-completed',
        unit: message.traceUnit,
        workerId: taskRun.lane
    });

    if (taskRun.activeTraceUnit.read() === message.traceUnit) {
        taskRun.activeTraceUnit.write(null);
    }
}

export function handleWorkerMessage(
    message: WorkerPoolMessage,
    taskRun: WorkerPoolTaskRun,
    runtime: WorkerPoolRunRuntime
): void {
    if (message.kind === 'output') {
        taskRun.state.recordCapturedOutput(
            message.stream,
            Buffer.from(message.chunk),
            message.capturedAtMicroseconds
        );
    } else if (message.kind === 'unit-started') {
        handleUnitStarted(message, taskRun, runtime);
    } else if (message.kind === 'unit-completed') {
        handleUnitCompleted(message, taskRun, runtime);
    } else {
        handleWorkerEvent(message.event, taskRun, runtime);
    }
}
