import { workIdentityKey } from '../engine/identity.ts';
import type { RunResult } from '../engine/run-result.ts';
import type { PlacementAttemptId, PlacementTraceEntry } from './placement-trace.ts';
import type { WorkerPoolRunRuntime, WorkerPoolTaskRun } from './worker-pool-runtime.ts';
import { currentReplay } from './replay-context.ts';

export type ReplayHedgeCompletion = { readonly result: RunResult; readonly taskRun: WorkerPoolTaskRun; };
const pending = new WeakMap<WorkerPoolRunRuntime, Map<PlacementAttemptId, ReplayHedgeCompletion>>();
const deferredTasks = new WeakSet<WorkerPoolTaskRun>();
function workKey(task: WorkerPoolTaskRun): string {
    return workIdentityKey(task.unit.work[0]);
}
function assignedAttempts(
    entries: readonly PlacementTraceEntry[],
    task: WorkerPoolTaskRun
): ReadonlySet<PlacementAttemptId> {
    const assigned = entries.filter(
        function sameAttempt(entry): entry is Extract<PlacementTraceEntry, { readonly kind: 'attempt-assigned'; }> {
            return entry.kind === 'attempt-assigned' && entry.work.some(function sameWork(work) {
                return workIdentityKey(work) === workKey(task);
            });
        }
    );
    return new Set(assigned.map(function attempt(entry) {
        return entry.attempt;
    }));
}
function explicitAuthority(
    entries: readonly PlacementTraceEntry[],
    attempts: ReadonlySet<PlacementAttemptId>
): PlacementAttemptId | null {
    for (const entry of entries) {
        if (
            (entry.kind === 'hedge-conflict' || entry.kind === 'hedge-resolved') &&
            attempts.has(entry.authoritativeAttempt)
        ) {
            return entry.authoritativeAttempt;
        }
    }
    return null;
}
function firstCompletion(
    entries: readonly PlacementTraceEntry[],
    attempts: ReadonlySet<PlacementAttemptId>
): PlacementAttemptId | null {
    for (const entry of entries) {
        if (entry.kind === 'attempt-completed' && attempts.has(entry.attempt)) {
            return entry.attempt;
        }
    }
    return attempts.values().next().value ?? null;
}
export function recordedHedgeAuthority(task: WorkerPoolTaskRun): PlacementAttemptId | null {
    const replay = currentReplay();
    if (replay?.kind !== 'record') {
        return null;
    }
    const entries = replay.record.placementTrace?.entries ?? [];
    const attempts = assignedAttempts(entries, task);
    return explicitAuthority(entries, attempts) ?? firstCompletion(entries, attempts);
}
export function deferReplayHedge(runtime: WorkerPoolRunRuntime, completion: ReplayHedgeCompletion): boolean {
    const authority = recordedHedgeAuthority(completion.taskRun);
    if (authority === null || authority === completion.taskRun.members[0].attempt) {
        return false;
    }
    const completions = pending.get(runtime) ?? new Map<PlacementAttemptId, ReplayHedgeCompletion>();
    completions.set(completion.taskRun.members[0].attempt, completion);
    pending.set(runtime, completions);
    deferredTasks.add(completion.taskRun);
    return true;
}
export function isDeferredReplayTask(task: WorkerPoolTaskRun): boolean {
    return deferredTasks.has(task);
}
export function pendingReplayHedges(
    runtime: WorkerPoolRunRuntime,
    task: WorkerPoolTaskRun
): readonly ReplayHedgeCompletion[] {
    return Array.from(pending.get(runtime)?.values() ?? []).filter(function sameWork(entry) {
        return workKey(entry.taskRun) === workKey(task);
    });
}
export function releaseReplayHedge(runtime: WorkerPoolRunRuntime, completion: ReplayHedgeCompletion): void {
    pending.get(runtime)?.delete(completion.taskRun.members[0].attempt);
}

function isFinalSourceCandidate(
    entry: PlacementTraceEntry,
    work: string
): entry is Extract<PlacementTraceEntry, { readonly kind: 'attempt-assigned'; }> {
    return entry.kind === 'attempt-assigned' && entry.reason.kind !== 'hedge' &&
        entry.work.some(function matching(identity) {
            return workIdentityKey(identity) === work;
        });
}
function finalRecordedAssignment(work: string): PlacementAttemptId | null {
    const replay = currentReplay();
    if (replay?.kind !== 'record') {
        return null;
    }
    let assigned: PlacementAttemptId | null = null;
    const entries = replay.record.placementTrace === null ? [] : replay.record.placementTrace.entries;
    for (const entry of entries) {
        if (isFinalSourceCandidate(entry, work)) {
            assigned = entry.attempt;
        }
    }
    return assigned;
}
export function replayPlacementResult(result: RunResult, members: WorkerPoolTaskRun['members']): RunResult {
    if (currentReplay()?.kind !== 'record') {
        return result;
    }
    return {
        ...result,
        perTest: result.perTest.filter(function authoritative(test) {
            const key = workIdentityKey(test.workId);
            const member = members.find(function assigned(entry) {
                return entry.unit.work.some(function matching(work) {
                    return workIdentityKey(work) === key;
                });
            });
            const authority = finalRecordedAssignment(key);
            return authority === null || member?.attempt === authority;
        })
    };
}
