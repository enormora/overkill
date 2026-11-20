import { isDeepStrictEqual } from 'node:util';
import type { ReporterEvent } from '../engine/reporter.ts';
import { caseIdentityKey, workIdentityKey, type AttemptId } from '../engine/identity.ts';
import { artifactsForAttempt } from '../engine/run-artifact.ts';
import type { PerTestResult } from '../engine/run-result.ts';

type SelectedWork = { readonly id: PerTestResult['id']; };
type ActiveAttempt = { readonly attempt: AttemptId; };

type RuntimeEvidence = {
    readonly active: ReadonlyMap<string, ActiveAttempt>;
    readonly attempts: ReadonlyMap<string, readonly PerTestResult[]>;
    readonly completed: ReadonlyMap<string, PerTestResult>;
};

type WorkEvent = Extract<ReporterEvent, { readonly workId: unknown; }>;

function isWorkEvent(event: ReporterEvent): event is WorkEvent {
    return Object.hasOwn(event, 'workId');
}

function assertSelectedEvent(event: WorkEvent, selected: ReadonlyMap<string, SelectedWork>): void {
    if (
        !selected.has(workIdentityKey(event.workId)) ||
        caseIdentityKey(event.case) !== caseIdentityKey(event.workId.case)
    ) {
        throw new TypeError('Runtime evidence does not identify selected work.');
    }
    if (!Number.isSafeInteger(event.attempt) || event.attempt < 0) {
        throw new TypeError('Runtime evidence requires a valid attempt index.');
    }
}

function assertStart(
    event: WorkEvent,
    active: ActiveAttempt | undefined,
    previous: readonly PerTestResult[],
    completed: boolean
): void {
    if (active !== undefined || completed || event.attempt !== previous.length) {
        throw new TypeError('Runtime start is duplicate or out of order.');
    }
}

function assertCompletionArtifacts(event: WorkEvent): void {
    if (event.kind !== 'test-end') {
        return;
    }
    const matching = artifactsForAttempt(event.artifacts, event.workId, { index: event.attempt });
    if (matching.length !== event.artifacts.length) {
        throw new TypeError('Runtime completion contains foreign attempt artifacts.');
    }
}

export function assertRuntimeEvent(
    event: ReporterEvent,
    selected: ReadonlyMap<string, SelectedWork>,
    evidence: RuntimeEvidence
): void {
    if (!isWorkEvent(event)) {
        return;
    }
    const { active, attempts, completed } = evidence;
    assertSelectedEvent(event, selected);
    const key = workIdentityKey(event.workId);
    if (event.kind === 'test-start') {
        assertStart(event, active.get(key), attempts.get(key) ?? [], completed.has(key));
    } else if (active.get(key)?.attempt.index !== event.attempt) {
        throw new TypeError('Runtime evidence does not belong to the active attempt.');
    }
    assertCompletionArtifacts(event);
}

function assertResultIdentity(
    result: PerTestResult,
    selected: ReadonlyMap<string, SelectedWork>,
    seen: ReadonlySet<string>
): void {
    const key = workIdentityKey(result.workId);
    if (!selected.has(key) || seen.has(key) || caseIdentityKey(result.id) !== caseIdentityKey(result.workId.case)) {
        throw new TypeError('Runtime results contain foreign or duplicate work identities.');
    }
}

function reportedAttemptEvidence(
    result: PerTestResult,
    accepted: PerTestResult
): readonly PerTestResult['attempts'][number][] {
    return result.attempts.map(function reportedAttempt(attempt, index) {
        return accepted.attempts[index]?.outcome === null ? { ...attempt, outcome: null } : attempt;
    });
}

function assertMatchingCompletion(result: PerTestResult, accepted: PerTestResult | undefined): void {
    if (accepted === undefined) {
        return;
    }
    if (
        !isDeepStrictEqual(accepted.attempts, reportedAttemptEvidence(result, accepted)) ||
        accepted.verdict !== result.verdict ||
        !isDeepStrictEqual(accepted.outcome, result.outcome)
    ) {
        throw new TypeError('Runtime result contradicts accepted completion evidence.');
    }
}

export function assertRuntimeResults(
    results: readonly PerTestResult[],
    selected: ReadonlyMap<string, SelectedWork>,
    completed: ReadonlyMap<string, PerTestResult>,
    pendingTerminal: ReadonlySet<string>
): void {
    const seen = new Set<string>();
    for (const result of results) {
        assertResultIdentity(result, selected, seen);
        const key = workIdentityKey(result.workId);
        seen.add(key);
        if (!pendingTerminal.has(key)) {
            assertMatchingCompletion(result, completed.get(key));
        }
    }
}
