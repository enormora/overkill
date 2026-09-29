import type { WorkId } from '../engine/identity.ts';
import type { NonEmptyReadonlyArray } from '../assertion-protocol/assertion-node-shape.ts';
import type { PlacementLane, WorkUnitId } from './run-types.ts';
import type { WarmLaneAffinityKeyKind } from './worker-pool-warm-lane-affinity.ts';

export type PlacementAttemptId = `attempt-${number}`;
export type PlacementWorkerId = `${number}:${number}`;

export type PlacementTrace = { readonly entries: readonly PlacementTraceEntry[]; };
export type DynamicWorkUnitId = { readonly child: string; readonly parent: WorkUnitId; };
export type TraceWorkUnitId = DynamicWorkUnitId | WorkUnitId;

export type PlacementAttemptReason = {
    readonly kind: 'hedge';
    readonly primaryAttempt: PlacementAttemptId;
} | {
    readonly kind: 'initial';
} | {
    readonly kind: 'recovery';
    readonly previousAttempt: PlacementAttemptId;
};

type PlacementExecutionInterruptionCause = 'hard-timeout' | 'host-failure' | 'run-stopped';
type PlacementPolicyInterruptionCause = 'hedge-cancelled' | 'runtime-policy' | 'worker-crash';
export type PlacementAttemptInterruptionCause = PlacementExecutionInterruptionCause | PlacementPolicyInterruptionCause;

export type PlacementRecoveryDecision = {
    readonly abandonedWork: NonEmptyReadonlyArray<WorkId>;
    readonly kind: 'abandon';
} | {
    readonly abandonedWork: NonEmptyReadonlyArray<WorkId>;
    readonly kind: 'partial';
    readonly retryWork: NonEmptyReadonlyArray<WorkId>;
} | {
    readonly kind: 'retry';
    readonly retryWork: NonEmptyReadonlyArray<WorkId>;
};

export type PlacementTraceEntry = {
    readonly activeAttempt: PlacementAttemptId | null;
    readonly kind: 'worker-crashed';
    readonly lane: PlacementLane['id'];
    readonly workerId: PlacementWorkerId | null;
} | {
    readonly attempt: PlacementAttemptId;
    readonly cause: PlacementAttemptInterruptionCause;
    readonly decision: PlacementRecoveryDecision;
    readonly kind: 'recovery-decided';
} | {
    readonly attempt: PlacementAttemptId;
    readonly cause: PlacementAttemptInterruptionCause;
    readonly kind: 'attempt-interrupted';
} | {
    readonly attempt: PlacementAttemptId;
    readonly durationMicroseconds: number;
    readonly kind: 'attempt-completed';
} | {
    readonly attempt: PlacementAttemptId;
    readonly kind: 'attempt-assigned';
    readonly lane: PlacementLane['id'];
    readonly reason: PlacementAttemptReason;
    readonly unit: TraceWorkUnitId;
    readonly work: NonEmptyReadonlyArray<WorkId>;
} | {
    readonly attempt: PlacementAttemptId;
    readonly kind: 'attempt-started';
    readonly workerId: PlacementWorkerId;
} | {
    readonly attempts: NonEmptyReadonlyArray<PlacementAttemptId>;
    readonly envelopeId: string;
    readonly kind: 'batch-completed' | 'batch-started';
    readonly lane: PlacementLane['id'];
} | {
    readonly authoritativeAttempt: PlacementAttemptId;
    readonly conflictingAttempt: PlacementAttemptId;
    readonly kind: 'hedge-conflict';
} | {
    readonly authoritativeAttempt: PlacementAttemptId;
    readonly discardedAttempt: PlacementAttemptId;
    readonly kind: 'hedge-resolved';
    readonly outcome: 'cancelled' | 'matched';
} | {
    readonly baselineUnit: TraceWorkUnitId;
    readonly candidateUnits: NonEmptyReadonlyArray<TraceWorkUnitId>;
    readonly kind: 'warm-lane-affinity-selected';
    readonly lane: PlacementLane['id'];
    readonly matchedWarmKeys: NonEmptyReadonlyArray<WarmLaneAffinityKeyKind>;
    readonly score: number;
    readonly selectedUnit: TraceWorkUnitId;
} | {
    readonly children: NonEmptyReadonlyArray<DynamicWorkUnitId>;
    readonly kind: 'unit-split';
    readonly parent: WorkUnitId;
};

type AttemptState = 'assigned' | 'completed' | 'interrupted' | 'recovered' | 'started';
type PlacementAttemptLifecycleEntryKind = 'attempt-assigned' | 'attempt-completed' | 'attempt-interrupted';
type PlacementAttemptOutcomeEntryKind = 'attempt-started' | 'recovery-decided';
type PlacementAttemptEntryKind = PlacementAttemptLifecycleEntryKind | PlacementAttemptOutcomeEntryKind;
export type PlacementDecisionEntry = Exclude<
    PlacementTraceEntry,
    { readonly kind: PlacementAttemptEntryKind; }
>;

export type PlacementTraceRecorder = {
    readonly assignAttempt: (
        unit: TraceWorkUnitId,
        work: NonEmptyReadonlyArray<WorkId>,
        lane: PlacementLane['id'],
        reason: PlacementAttemptReason
    ) => PlacementAttemptId;
    readonly completeAttempt: (attempt: PlacementAttemptId, durationMicroseconds: number) => void;
    readonly decideRecovery: (
        attempt: PlacementAttemptId,
        cause: PlacementAttemptInterruptionCause,
        decision: PlacementRecoveryDecision
    ) => void;
    readonly entries: () => readonly PlacementTraceEntry[];
    readonly finish: () => PlacementTrace;
    readonly interruptAttempt: (attempt: PlacementAttemptId, cause: PlacementAttemptInterruptionCause) => void;
    readonly recordDecision: (entry: PlacementDecisionEntry) => void;
    readonly startAttempt: (attempt: PlacementAttemptId, workerId: PlacementWorkerId) => void;
};

function frozen<Value>(value: Value): Value {
    if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
        for (const child of Object.values(value)) {
            frozen(child);
        }
        Object.freeze(value);
    }
    return value;
}

export function createPlacementTraceRecorder(): PlacementTraceRecorder {
    const entries: PlacementTraceEntry[] = [];
    const states = new Map<PlacementAttemptId, AttemptState>();
    let nextAttempt = 1;
    let finished = false;

    function writable(): void {
        if (finished) {
            throw new Error('Placement trace is already finished.');
        }
    }
    function requireState(attempt: PlacementAttemptId, expected: AttemptState): void {
        if (states.get(attempt) !== expected) {
            throw new Error(`Placement attempt ${attempt} is not ${expected}.`);
        }
    }

    return {
        assignAttempt(unit, work, lane, reason) {
            writable();
            const attempt: PlacementAttemptId = `attempt-${nextAttempt}`;
            nextAttempt += 1;
            states.set(attempt, 'assigned');
            entries.push({ attempt, kind: 'attempt-assigned', lane, reason, unit, work });
            return attempt;
        },
        completeAttempt(attempt, durationMicroseconds) {
            writable();
            requireState(attempt, 'started');
            states.set(attempt, 'completed');
            entries.push({ attempt, durationMicroseconds, kind: 'attempt-completed' });
        },
        decideRecovery(attempt, cause, decision) {
            writable();
            requireState(attempt, 'interrupted');
            states.set(attempt, 'recovered');
            entries.push({ attempt, cause, decision, kind: 'recovery-decided' });
        },
        entries() {
            return entries;
        },
        finish() {
            writable();
            const incompleteAttempt = Array.from(states).find(function isIncomplete([ , state ]) {
                return state !== 'completed' && state !== 'recovered';
            });

            if (incompleteAttempt !== undefined) {
                throw new Error(`Placement attempt ${incompleteAttempt[0]} is not terminal.`);
            }

            finished = true;
            return frozen({ entries: structuredClone(entries) });
        },
        interruptAttempt(attempt, cause) {
            writable();
            const current = states.get(attempt);
            if (current !== 'assigned' && current !== 'started') {
                throw new Error(`Placement attempt ${attempt} cannot be interrupted.`);
            }
            states.set(attempt, 'interrupted');
            entries.push({ attempt, cause, kind: 'attempt-interrupted' });
        },
        recordDecision(entry) {
            writable();
            entries.push(entry);
        },
        startAttempt(attempt, workerId) {
            writable();
            requireState(attempt, 'assigned');
            states.set(attempt, 'started');
            entries.push({ attempt, kind: 'attempt-started', workerId });
        }
    };
}

export function traceUnitKey(unit: TraceWorkUnitId): string {
    return JSON.stringify(unit);
}
