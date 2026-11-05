import { workIdentityKey } from '../engine/identity.ts';
import { validateReplayPlacement } from './replay-placement-validation.ts';
import { unitIsHedgeSafe, unitHasNoHardConstraints } from './worker-pool-hedge-dispatch.ts';
import {
    createPlacementTraceRecorder,
    traceUnitKey,
    parentWorkUnitId,
    isDynamicWorkUnitId,
    type PlacementAttemptId,
    type PlacementTraceEntry,
    type PlacementTraceRecorder
} from './placement-trace.ts';
import type { PlacementPlan, WorkUnit } from './run-types.ts';
import type { ReplayRunRecord } from './replay-record-types.ts';

export type ReplayTraceSource = Pick<ReplayRunRecord, 'placementTrace' | 'status'>;
export type ReplayAssignment = Extract<PlacementTraceEntry, { readonly kind: 'attempt-assigned'; }>;
type ReplayBatch = Extract<PlacementTraceEntry, { readonly kind: 'batch-completed' | 'batch-started'; }>;
export type ReplayTracePlan = {
    readonly assignments: ReadonlyMap<PlacementAttemptId, ReplayAssignment>;
    readonly batches: ReadonlyMap<PlacementAttemptId, ReplayBatch>;
    readonly entries: readonly PlacementTraceEntry[];
    readonly units: ReadonlyMap<string, WorkUnit>;
};
type AssignmentLedger = ReadonlyMap<PlacementAttemptId, ReplayAssignment> & {
    readonly set: (
        attempt: PlacementAttemptId,
        entry: ReplayAssignment
    ) => ReadonlyMap<PlacementAttemptId, ReplayAssignment>;
};
type BatchLedger = ReadonlyMap<PlacementAttemptId, ReplayBatch> & {
    readonly set: (attempt: PlacementAttemptId, entry: ReplayBatch) => ReadonlyMap<PlacementAttemptId, ReplayBatch>;
};
type WorkLedger = ReadonlySet<string> & { readonly add: (key: string) => ReadonlySet<string>; };
type TraceCompilation = {
    readonly assignments: AssignmentLedger;
    readonly batches: BatchLedger;
    readonly entries: readonly PlacementTraceEntry[];
    readonly units: ReadonlyMap<string, WorkUnit>;
    readonly lanes: ReadonlySet<string>;
    readonly seenWork: WorkLedger;
    readonly dynamicUnits: WorkLedger;
    readonly validation: PlacementTraceRecorder;
    readonly appendEntry: (entry: PlacementTraceEntry) => void;
};
function assignmentParent(entry: ReplayAssignment, state: TraceCompilation): WorkUnit {
    const unit = state.units.get(traceUnitKey(parentWorkUnitId(entry.unit)));
    if (unit === undefined || !state.lanes.has(entry.lane)) {
        throw new TypeError('Replay assignment has an unknown unit or lane.');
    }
    if (isDynamicWorkUnitId(entry.unit) && !state.dynamicUnits.has(traceUnitKey(entry.unit))) {
        throw new TypeError('Replay assignment has an unknown split child.');
    }
    return unit;
}
function assertAssignmentWork(entry: ReplayAssignment, unit: WorkUnit, state: TraceCompilation): void {
    const eligible = new Set(unit.work.map(workIdentityKey));
    const work = entry.work.map(workIdentityKey);
    const uniqueWork = new Set(work);
    if (
        uniqueWork.size !== work.length || work.some(function outside(key) {
            return !eligible.has(key);
        })
    ) {
        throw new TypeError('Replay assignment contains duplicate or unrelated work.');
    }
    for (const key of work) {
        state.seenWork.add(key);
    }
}
function assertPredecessor(entry: ReplayAssignment, state: TraceCompilation): void {
    if (entry.reason.kind === 'initial') {
        return;
    }
    const previous = entry.reason.kind === 'hedge' ? entry.reason.primaryAttempt : entry.reason.previousAttempt;
    const assignment = state.assignments.get(previous);
    if (
        assignment === undefined ||
        traceUnitKey(parentWorkUnitId(assignment.unit)) !== traceUnitKey(parentWorkUnitId(entry.unit))
    ) {
        throw new TypeError('Replay assignment has an unknown or unrelated predecessor.');
    }
}
function assertHedgePolicy(entry: ReplayAssignment, unit: WorkUnit): void {
    if (entry.reason.kind !== 'hedge') {
        return;
    }
    if (entry.work.length !== 1 || !unitIsHedgeSafe(unit) || !unitHasNoHardConstraints(unit)) {
        throw new TypeError('Replay hedge violates saved duplication constraints.');
    }
}

function assertAssignmentPolicy(entry: ReplayAssignment, unit: WorkUnit, state: TraceCompilation): void {
    if (
        entry.reason.kind === 'initial' && entry.work.some(function repeated(work) {
            return state.seenWork.has(workIdentityKey(work));
        })
    ) {
        throw new TypeError('Replay initial assignments overlap.');
    }
    assertHedgePolicy(entry, unit);
}

function registerAssignment(entry: ReplayAssignment, state: TraceCompilation): boolean {
    const unit = assignmentParent(entry, state);
    assertAssignmentPolicy(entry, unit, state);
    assertAssignmentWork(entry, unit, state);
    assertPredecessor(entry, state);
    if (state.validation.assignAttempt(entry.unit, entry.work, entry.lane, entry.reason) !== entry.attempt) {
        throw new TypeError('Replay attempt identities are inconsistent.');
    }
    state.assignments.set(entry.attempt, entry);
    return true;
}
function registerSplit(
    entry: Extract<PlacementTraceEntry, { readonly kind: 'unit-split'; }>,
    state: TraceCompilation
): boolean {
    const parent = traceUnitKey(entry.parent);
    if (!state.units.has(parent)) {
        throw new TypeError('Replay split has an unknown parent.');
    }
    for (const child of entry.children) {
        const key = traceUnitKey(child);
        if (traceUnitKey(child.parent) !== parent || state.dynamicUnits.has(key)) {
            throw new TypeError('Replay split has an unrelated or duplicate child.');
        }
        state.dynamicUnits.add(key);
    }
    return true;
}
function registerBatch(entry: ReplayBatch, state: TraceCompilation): boolean {
    for (const id of entry.attempts) {
        if (state.assignments.get(id)?.lane !== entry.lane || state.batches.has(id)) {
            throw new TypeError('Replay batch has incompatible or duplicate members.');
        }
        state.batches.set(id, entry);
    }
    return true;
}
function validateBatchCompletion(entry: ReplayBatch, state: TraceCompilation): boolean {
    if (
        entry.attempts.some(function unmatched(id) {
            const started = state.batches.get(id);
            return started?.envelopeId !== entry.envelopeId || started.lane !== entry.lane;
        })
    ) {
        throw new TypeError('Replay batch completion has no matching batch.');
    }
    return true;
}
function sameAssignmentWork(authority: ReplayAssignment | undefined, duplicate: ReplayAssignment | undefined): boolean {
    if (authority === undefined || duplicate === undefined) {
        return false;
    }
    return JSON.stringify(authority.work.map(workIdentityKey)) === JSON.stringify(duplicate.work.map(workIdentityKey));
}
function validateHedge(entry: PlacementTraceEntry, state: TraceCompilation): void {
    if (entry.kind !== 'hedge-conflict' && entry.kind !== 'hedge-resolved') {
        return;
    }
    const authority = state.assignments.get(entry.authoritativeAttempt);
    const duplicate = state.assignments.get(
        entry.kind === 'hedge-conflict' ? entry.conflictingAttempt : entry.discardedAttempt
    );
    if (!sameAssignmentWork(authority, duplicate)) {
        throw new TypeError('Replay hedge decision refers to unrelated attempts.');
    }
}
function registerTopology(entry: PlacementTraceEntry, state: TraceCompilation): boolean {
    if (entry.kind === 'unit-split') {
        return registerSplit(entry, state);
    }
    if (entry.kind === 'attempt-assigned') {
        return registerAssignment(entry, state);
    }
    if (entry.kind === 'batch-started') {
        return registerBatch(entry, state);
    }
    if (entry.kind === 'batch-completed') {
        return validateBatchCompletion(entry, state);
    }
    return false;
}
function validateAttemptOutcome(entry: PlacementTraceEntry, state: TraceCompilation): boolean {
    if (entry.kind === 'attempt-interrupted') {
        state.validation.interruptAttempt(entry.attempt, entry.cause);
        return true;
    }
    if (entry.kind === 'recovery-decided') {
        state.validation.decideRecovery(entry.attempt, entry.cause, entry.decision);
        return true;
    }
    return false;
}
function validateLifecycle(entry: PlacementTraceEntry, state: TraceCompilation): boolean {
    if (entry.kind === 'attempt-started') {
        state.validation.startAttempt(entry.attempt, entry.workerId);
        return true;
    }
    if (entry.kind === 'attempt-completed') {
        state.validation.completeAttempt(entry.attempt, entry.durationMicroseconds);
        return true;
    }
    return validateAttemptOutcome(entry, state);
}
function validateWorkerCrash(
    entry: Extract<PlacementTraceEntry, { readonly kind: 'worker-crashed'; }>,
    state: TraceCompilation
): void {
    if (!state.lanes.has(entry.lane)) {
        throw new TypeError('Replay crash refers to an unknown lane.');
    }
    if (entry.activeAttempt !== null && state.assignments.get(entry.activeAttempt)?.lane !== entry.lane) {
        throw new TypeError('Replay crash refers to an unrelated attempt.');
    }
}

function validateWarmLane(
    entry: Extract<PlacementTraceEntry, { readonly kind: 'warm-lane-affinity-selected'; }>,
    state: TraceCompilation
): void {
    if (!state.lanes.has(entry.lane)) {
        throw new TypeError('Replay warm affinity refers to an unknown lane.');
    }
    const units = [ entry.baselineUnit, entry.selectedUnit, ...entry.candidateUnits ];
    if (
        units.some(function unknown(unit) {
            return !state.units.has(traceUnitKey(parentWorkUnitId(unit)));
        })
    ) {
        throw new TypeError('Replay warm affinity refers to unknown work.');
    }
}

function validateEntry(entry: PlacementTraceEntry, state: TraceCompilation): void {
    if (registerTopology(entry, state) || validateLifecycle(entry, state)) {
        return;
    }
    if (entry.kind === 'worker-crashed') {
        validateWorkerCrash(entry, state);
    } else if (entry.kind === 'warm-lane-affinity-selected') {
        validateWarmLane(entry, state);
    }
    validateHedge(entry, state);
}

function continueAssignment(assignment: PlacementPlan['assignments'][number], state: TraceCompilation): void {
    const unit = state.units.get(traceUnitKey(assignment.unit));
    if (unit === undefined) {
        throw new TypeError('Replay placement has an unknown unit.');
    }
    const [ first, ...rest ] = unit.work.filter(function unseen(work) {
        return !state.seenWork.has(workIdentityKey(work));
    });
    if (first === undefined) {
        return;
    }
    const work = [ first, ...rest ] as const;
    const entry: ReplayAssignment = {
        kind: 'attempt-assigned',
        attempt: state.validation.assignAttempt(unit.id, work, assignment.lane, { kind: 'initial' }),
        unit: unit.id,
        work,
        lane: assignment.lane,
        reason: { kind: 'initial' }
    };
    state.assignments.set(entry.attempt, entry);
    state.appendEntry(entry);
}
function appendContinuation(plan: PlacementPlan, state: TraceCompilation): void {
    for (const assignment of plan.assignments) {
        continueAssignment(assignment, state);
    }
}
export function compileReplayTrace(plan: PlacementPlan, record: ReplayTraceSource): ReplayTracePlan {
    validateReplayPlacement(
        plan,
        plan.units.flatMap(function members(unit) {
            return unit.work;
        })
    );
    const entries = Array.from(record.placementTrace?.entries ?? []);
    const state: TraceCompilation = {
        appendEntry(entry) {
            entries.push(entry);
        },
        entries,
        assignments: new Map(),
        batches: new Map(),
        units: new Map(plan.units.map(function keyed(unit) {
            return [ traceUnitKey(unit.id), unit ];
        })),
        lanes: new Set(plan.lanes.map(function lane(entry) {
            return entry.id;
        })),
        seenWork: new Set(),
        dynamicUnits: new Set(),
        validation: createPlacementTraceRecorder()
    };
    for (const entry of state.entries) {
        validateEntry(entry, state);
    }
    if (record.status === 'completed') {
        state.validation.finish();
    } else {
        appendContinuation(plan, state);
    }
    return state;
}
