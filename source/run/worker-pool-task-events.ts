import { createDefaultWorkId, workIdentityKey } from '../engine/identity.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import {
    applyEvent
} from './supervised-run-runtime.ts';
import type { SupervisedCase } from './supervised-run-state.ts';
import {
    crashError
} from './supervised-run-resource-policy.ts';
import type { WorkUnit } from './run-types.ts';
import type {
    WorkerPoolMessage
} from './worker-pool-protocol.ts';
import type { WorkerPoolRunRuntime, WorkerPoolTaskRun } from './worker-pool-runtime.ts';

type RuntimeReporterEvent = Parameters<WorkerPoolRunRuntime['reporterDelivery']['reportEvent']>[0];

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

export function recordTaskCrash(
    taskRun: WorkerPoolTaskRun,
    runtime: WorkerPoolRunRuntime,
    message: string
): void {
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
        casesByKey(taskRun.unit),
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
    } else {
        handleWorkerEvent(message.event, taskRun, runtime);
    }
}
