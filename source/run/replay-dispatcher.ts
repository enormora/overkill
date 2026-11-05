import { workResourceConstraints } from './work-unit-resource-constraints.ts';
import {
    createChangeWaiters,
    type ChangeWaiters,
    type WorkerPoolWorkDispatcher,
    type WorkerPoolUnitLease
} from './worker-pool-dispatch-state.ts';
import { createStoredRunValue, type StoredRunValue } from './supervised-run-state.ts';
import type { WorkerPoolRunRuntime, WorkerPoolTaskRun } from './worker-pool-runtime.ts';
import {
    isDynamicWorkUnitId,
    parentWorkUnitId,
    traceUnitKey,
    type PlacementAttemptId,
    type PlacementTraceEntry
} from './placement-trace.ts';
import type { PlacementPlan, PlacementLane } from './run-types.ts';
import {
    compileReplayTrace,
    type ReplayTracePlan,
    type ReplayTraceSource,
    type ReplayAssignment
} from './replay-trace-plan.ts';

type AttemptLedger = ReadonlySet<PlacementAttemptId> & {
    readonly add: (attempt: PlacementAttemptId) => ReadonlySet<PlacementAttemptId>;
};
type ReplayDispatchState = {
    readonly runtime: WorkerPoolRunRuntime;
    readonly compiled: ReplayTracePlan;
    readonly waiters: ChangeWaiters;
    readonly dispatched: AttemptLedger;
    readonly completed: AttemptLedger;
    readonly cancelled: AttemptLedger;
    readonly cursor: StoredRunValue<number>;
    readonly stopped: StoredRunValue<boolean>;
};
function cancelDuplicateTask(task: WorkerPoolTaskRun, attempt: PlacementAttemptId, state: ReplayDispatchState): void {
    state.cancelled.add(attempt);
    state.runtime.placementTrace.interruptAttempt(attempt, 'hedge-cancelled');
    task.endedByParent.write(true);
    task.requeuePendingCases.write(false);
    task.includeArtifacts.write(false);
    task.interruptionCause.write('hedge-cancelled');
    task.controller.abort();
}
function cancelRecordedDuplicate(attempt: PlacementAttemptId, state: ReplayDispatchState): void {
    if (state.cancelled.has(attempt)) {
        return;
    }
    for (const task of state.runtime.activeTasks) {
        if (
            task.members.some(function matching(member) {
                return member.attempt === attempt;
            }) && !task.completedAttempts.has(attempt)
        ) {
            cancelDuplicateTask(task, attempt, state);
        }
    }
}
function awaitingCompletion(entry: PlacementTraceEntry, state: ReplayDispatchState): boolean {
    if (entry.kind !== 'attempt-completed' && entry.kind !== 'attempt-interrupted') {
        return false;
    }
    if (entry.kind === 'attempt-interrupted' && entry.cause === 'hedge-cancelled') {
        cancelRecordedDuplicate(entry.attempt, state);
    }
    return !state.completed.has(entry.attempt);
}
function recordStructuralDecision(entry: PlacementTraceEntry, state: ReplayDispatchState): void {
    if (entry.kind === 'unit-split' || entry.kind === 'warm-lane-affinity-selected') {
        state.runtime.placementTrace.recordDecision(entry);
    }
}
function awaitingDispatch(entry: PlacementTraceEntry, state: ReplayDispatchState): entry is ReplayAssignment {
    return entry.kind === 'attempt-assigned' && !state.dispatched.has(entry.attempt);
}
function advanceDecision(entry: PlacementTraceEntry, state: ReplayDispatchState): boolean {
    if (awaitingCompletion(entry, state)) {
        return false;
    }
    recordStructuralDecision(entry, state);
    state.cursor.write(state.cursor.read() + 1);
    return true;
}
function advanceRecordedDecisions(state: ReplayDispatchState): ReplayAssignment | null {
    while (state.cursor.read() < state.compiled.entries.length) {
        const entry = state.compiled.entries[state.cursor.read()];
        if (entry === undefined) {
            return null;
        }
        if (awaitingDispatch(entry, state)) {
            return entry;
        }
        if (!advanceDecision(entry, state)) {
            return null;
        }
    }
    return null;
}
function pendingAssignment(state: ReplayDispatchState): ReplayAssignment | null {
    return state.stopped.read() ? null : advanceRecordedDecisions(state);
}
function dispatchMember(
    entry: ReplayAssignment,
    lane: PlacementLane,
    state: ReplayDispatchState
): WorkerPoolUnitLease['members'][number] {
    const unit = state.compiled.units.get(traceUnitKey(parentWorkUnitId(entry.unit)));
    if (unit === undefined) {
        throw new TypeError('Replay parent unit is unavailable.');
    }
    const attempt = state.runtime.placementTrace.assignAttempt(entry.unit, entry.work, lane.id, entry.reason);
    if (attempt !== entry.attempt) {
        throw new TypeError('Replay attempt sequence diverged.');
    }
    state.dispatched.add(attempt);
    const resourceConstraints = isDynamicWorkUnitId(entry.unit)
        ? workResourceConstraints(entry.work, state.runtime.collectedPlan)
        : unit.resourceConstraints;
    return { attempt, traceUnit: entry.unit, unit: { ...unit, resourceConstraints, work: entry.work } };
}
function assignmentEntries(next: ReplayAssignment, state: ReplayDispatchState): readonly ReplayAssignment[] {
    const batch = state.compiled.batches.get(next.attempt);
    return batch === undefined ? [ next ] : batch.attempts.map(function batchEntry(id) {
        const entry = state.compiled.assignments.get(id);
        if (entry === undefined) {
            throw new TypeError('Replay batch member is unavailable.');
        }
        return entry;
    });
}
function assignRecordedMembers(
    next: ReplayAssignment,
    lane: PlacementLane,
    state: ReplayDispatchState
): WorkerPoolUnitLease['members'] {
    const members = assignmentEntries(next, state).map(function dispatch(entry) {
        return dispatchMember(entry, lane, state);
    });
    const [ first, ...rest ] = members;
    if (first === undefined) {
        throw new TypeError('Replay batch must have a member.');
    }
    return [ first, ...rest ];
}
function pullRecordedAssignment(lane: PlacementLane, state: ReplayDispatchState): WorkerPoolUnitLease | null {
    const next = pendingAssignment(state);
    if (next?.lane !== lane.id) {
        return null;
    }
    const members = assignRecordedMembers(next, lane, state);
    const first = members[0];
    state.waiters.notify();
    return {
        kind: next.reason.kind === 'hedge' ? 'hedged-duplicate' : 'primary',
        envelopeId: state.compiled.batches.get(next.attempt)?.envelopeId ?? null,
        lane,
        members,
        reservation: { faultDomains: [], hardKeys: [] },
        traceUnit: first.traceUnit,
        unit: first.unit
    };
}
export function createReplayDispatcher(
    runtime: WorkerPoolRunRuntime,
    plan: PlacementPlan,
    record: ReplayTraceSource
): WorkerPoolWorkDispatcher {
    const state: ReplayDispatchState = {
        runtime,
        compiled: compileReplayTrace(plan, record),
        waiters: createChangeWaiters(),
        dispatched: new Set(),
        completed: new Set(),
        cancelled: new Set(),
        cursor: createStoredRunValue(0),
        stopped: createStoredRunValue(false)
    };
    return {
        pull(lane) {
            return pullRecordedAssignment(lane, state);
        },
        blocked() {
            pendingAssignment(state);
            return !state.stopped.read() && state.cursor.read() < state.compiled.entries.length;
        },
        clear() {
            state.stopped.write(true);
            state.waiters.notify();
        },
        finish(lease) {
            for (const member of lease.members) {
                state.completed.add(member.attempt);
            }
            state.waiters.notify();
        },
        requeue() {
            state.waiters.notify();
        },
        async waitForChange() {
            await state.waiters.wait();
        }
    };
}
