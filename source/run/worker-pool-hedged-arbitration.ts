import { workIdentityKey } from '../engine/identity.ts';
import type { PerTestResult, RunResult, HedgedConflictArtifact, RunArtifact } from '../engine/run-result.ts';
import type { WorkUnit } from './run-types.ts';
import {
    workerPoolPlacementTrace,
    type WorkerPoolRunRuntime,
    type WorkerPoolTaskRun
} from './worker-pool-runtime.ts';

type RuntimeReporterEvent = Parameters<WorkerPoolRunRuntime['reporterDelivery']['reportEvent']>[0];

type AuthoritativeTaskRun = {
    readonly result: RunResult;
    readonly taskRun: WorkerPoolTaskRun;
};

export type HedgedAuthorities = {
    readonly get: (key: string) => AuthoritativeTaskRun | undefined;
    readonly set: (key: string, authority: AuthoritativeTaskRun) => void;
};

function taskWorkKey(taskRun: WorkerPoolTaskRun): string {
    return workIdentityKey(taskRun.unit.work[0]);
}

function hedgingEnabledForUnit(runtime: WorkerPoolRunRuntime, unit: WorkUnit): boolean {
    const { execution } = runtime.resolvedRun.facts;

    return execution.processModel === 'worker-pool' &&
        execution.hedging.mode !== 'off' &&
        unit.work.length === 1;
}

function unitUsesExternallySharedOwner(runtime: WorkerPoolRunRuntime, unit: WorkUnit): boolean {
    const workKeys = new Set(unit.work.map(workIdentityKey));
    const { placementPlan } = runtime.resolvedRun.facts.execution;

    return placementPlan?.resourceOwnership.owners.some(function ownerSharesAcrossAttempts(owner) {
        return (owner.scope === 'per-run' || owner.placement.kind === 'infrastructure-worker') &&
            owner.work.some(function ownerUsesUnitWork(work) {
                return workKeys.has(workIdentityKey(work));
            });
    }) ?? false;
}

export function unitCanUseBufferedHedging(runtime: WorkerPoolRunRuntime, unit: WorkUnit): boolean {
    if (!hedgingEnabledForUnit(runtime, unit)) {
        return false;
    }

    if (unit.resourceConstraints.duplicateExecution.includes('idempotent')) {
        return true;
    }

    return !unitUsesExternallySharedOwner(runtime, unit) &&
        unit.workerLifecycle === 'fresh-worker-per-unit' &&
        unit.resourceConstraints.duplicateExecution.includes('disposable-isolated');
}

function firstPerTestResult(result: RunResult): PerTestResult | null {
    return result.perTest[0] ?? null;
}

function comparableResult(result: PerTestResult): string {
    return JSON.stringify({
        outcome: result.outcome,
        verdict: result.verdict
    });
}

function semanticallyMatches(left: RunResult, right: RunResult): boolean {
    const leftResult = firstPerTestResult(left);
    const rightResult = firstPerTestResult(right);

    return leftResult !== null &&
        rightResult !== null &&
        comparableResult(leftResult) === comparableResult(rightResult);
}

function activePeerExists(runtime: WorkerPoolRunRuntime, taskRun: WorkerPoolTaskRun): boolean {
    const key = taskWorkKey(taskRun);

    for (const activeTask of runtime.activeTasks) {
        if (activeTask !== taskRun && taskWorkKey(activeTask) === key) {
            return true;
        }
    }

    return false;
}

function cancelHedgedPeer(
    runtime: WorkerPoolRunRuntime,
    authority: WorkerPoolTaskRun,
    discarded: WorkerPoolTaskRun
): void {
    const discardedAttempt = discarded.members[0].attempt;

    discarded.endedByParent.write(true);
    discarded.requeuePendingCases.write(false);
    discarded.includeArtifacts.write(false);
    discarded.interruptionCause.write('hedge-cancelled');
    workerPoolPlacementTrace(runtime).interruptAttempt(discardedAttempt, 'hedge-cancelled');
    workerPoolPlacementTrace(runtime).recordDecision({
        authoritativeAttempt: authority.members[0].attempt,
        discardedAttempt,
        kind: 'hedge-resolved',
        outcome: 'cancelled'
    });
    discarded.controller.abort();
}

function cancelActiveHedgedPeers(runtime: WorkerPoolRunRuntime, taskRun: WorkerPoolTaskRun): void {
    const key = taskWorkKey(taskRun);
    const activePeers = Array.from(runtime.activeTasks).filter(function isIncompleteActivePeer(activeTask) {
        const { attempt } = activeTask.members[0];

        return activeTask !== taskRun &&
            taskWorkKey(activeTask) === key &&
            !activeTask.completedAttempts.has(attempt);
    });

    for (const activeTask of activePeers) {
        cancelHedgedPeer(runtime, taskRun, activeTask);
    }
}

async function reportBufferedEvent(
    event: RuntimeReporterEvent,
    runtime: WorkerPoolRunRuntime
): Promise<void> {
    const errors = await runtime.reporterDelivery.reportEvent(event);

    if (errors.length > 0) {
        runtime.runState.recordRunnerErrors(errors);
    }
}

async function flushBufferedReporterEvents(
    taskRun: WorkerPoolTaskRun,
    runtime: WorkerPoolRunRuntime
): Promise<void> {
    for (const event of taskRun.bufferedReporterEvents) {
        await reportBufferedEvent(event, runtime);
    }

    taskRun.bufferedReporterEvents.clear();
}

async function finalizeAuthority(
    authority: AuthoritativeTaskRun,
    runtime: WorkerPoolRunRuntime
): Promise<void> {
    runtime.taskResults.push(authority.result);
    await flushBufferedReporterEvents(authority.taskRun, runtime);
}

function conflictArtifactId(result: PerTestResult, sequence: number): HedgedConflictArtifact['id'] {
    return {
        attempt: result.attempts.at(-1)?.attempt ?? result.attempts[0].attempt,
        runtimes: result.workId.runtimes,
        scope: {
            activeCases: [ result.id ],
            case: result.id,
            confidence: 'active-case',
            kind: 'case'
        },
        sequence,
        subtype: 'hedged-conflict',
        workload: result.workId.workload
    };
}

function conflictArtifact(
    authoritativeResult: PerTestResult,
    conflictingResult: PerTestResult,
    runtime: WorkerPoolRunRuntime
): RunArtifact {
    const artifactId = conflictArtifactId(authoritativeResult, runtime.runState.artifacts().length);

    return {
        id: artifactId,
        payload: {
            authoritative: {
                attempts: authoritativeResult.attempts,
                outcome: authoritativeResult.outcome,
                verdict: authoritativeResult.verdict
            },
            conflicting: {
                attempts: conflictingResult.attempts,
                outcome: conflictingResult.outcome,
                verdict: conflictingResult.verdict
            },
            kind: 'hedged-conflict',
            work: authoritativeResult.workId
        },
        source: 'native'
    };
}

function conflictPerTestResult(
    authoritativeResult: PerTestResult,
    artifact: RunArtifact
): PerTestResult {
    return {
        ...authoritativeResult,
        retried: authoritativeResult.retried === null ? null : { ...authoritativeResult.retried, finalVerdict: 'fail' },
        outcome: {
            failures: [ {
                artifact: artifact.id,
                kind: 'hedged-duplicate-conflict',
                summary: 'Hedged duplicate execution produced conflicting outcomes.'
            } ],
            kind: 'fail'
        },
        verdict: 'fail'
    };
}

function conflictResult(
    authority: AuthoritativeTaskRun,
    conflicting: RunResult,
    taskRun: WorkerPoolTaskRun,
    runtime: WorkerPoolRunRuntime
): RunResult | null {
    const authoritativeResult = firstPerTestResult(authority.result);
    const conflictingResult = firstPerTestResult(conflicting);

    if (authoritativeResult === null || conflictingResult === null) {
        return null;
    }

    const artifact = conflictArtifact(authoritativeResult, conflictingResult, runtime);
    runtime.runState.recordArtifact(artifact);
    workerPoolPlacementTrace(runtime).recordDecision({
        authoritativeAttempt: authority.taskRun.members[0].attempt,
        conflictingAttempt: taskRun.members[0].attempt,
        kind: 'hedge-conflict'
    });

    return {
        ...authority.result,
        artifacts: [],
        perTest: [ conflictPerTestResult(authoritativeResult, artifact) ],
        runnerErrors: []
    };
}

async function recordFirstAuthority(
    authorities: HedgedAuthorities,
    authority: AuthoritativeTaskRun,
    runtime: WorkerPoolRunRuntime
): Promise<void> {
    authorities.set(taskWorkKey(authority.taskRun), authority);
    cancelActiveHedgedPeers(runtime, authority.taskRun);

    if (!activePeerExists(runtime, authority.taskRun)) {
        await finalizeAuthority(authority, runtime);
    }
}

async function recordMatchingDuplicate(
    authority: AuthoritativeTaskRun,
    taskRun: WorkerPoolTaskRun,
    runtime: WorkerPoolRunRuntime
): Promise<void> {
    taskRun.includeArtifacts.write(false);
    workerPoolPlacementTrace(runtime).recordDecision({
        authoritativeAttempt: authority.taskRun.members[0].attempt,
        discardedAttempt: taskRun.members[0].attempt,
        kind: 'hedge-resolved',
        outcome: 'matched'
    });

    if (!activePeerExists(runtime, taskRun)) {
        await finalizeAuthority(authority, runtime);
    }
}

function recordConflictingDuplicate(
    authority: AuthoritativeTaskRun,
    result: RunResult,
    taskRun: WorkerPoolTaskRun,
    runtime: WorkerPoolRunRuntime
): void {
    taskRun.includeArtifacts.write(false);
    authority.taskRun.includeArtifacts.write(false);
    const conflictingResult = conflictResult(authority, result, taskRun, runtime);

    if (conflictingResult !== null) {
        runtime.taskResults.push(conflictingResult);
    }
}

export async function recordCompletedHedgedTaskRun(
    authorities: HedgedAuthorities,
    result: RunResult,
    taskRun: WorkerPoolTaskRun,
    runtime: WorkerPoolRunRuntime
): Promise<void> {
    const authority = authorities.get(taskWorkKey(taskRun));

    if (authority === undefined) {
        await recordFirstAuthority(authorities, { result, taskRun }, runtime);
    } else if (semanticallyMatches(authority.result, result)) {
        await recordMatchingDuplicate(authority, taskRun, runtime);
    } else {
        recordConflictingDuplicate(authority, result, taskRun, runtime);
    }
}

export function recordCancelledHedgedTaskRun(
    authorities: HedgedAuthorities,
    taskRun: WorkerPoolTaskRun,
    runtime: WorkerPoolRunRuntime
): void {
    taskRun.includeArtifacts.write(false);
    const authority = authorities.get(taskWorkKey(taskRun));

    if (authority !== undefined && !activePeerExists(runtime, taskRun)) {
        runtime.taskResults.push(authority.result);
        runtime.reporterEvents.add(flushBufferedReporterEvents(authority.taskRun, runtime));
    }
}
