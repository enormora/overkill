import type { NonEmptyReadonlyArray } from '../assertion-protocol/assertion-node-shape.ts';
import type { PlacementLane, WorkUnitId } from './run-types.ts';
import type { WarmLaneAffinityKeyKind } from './worker-pool-warm-lane-affinity.ts';

export type PlacementTrace = {
    readonly entries: readonly PlacementTraceEntry[];
};

export type DynamicWorkUnitId = {
    readonly child: string;
    readonly parent: WorkUnitId;
};

export type TraceWorkUnitId = DynamicWorkUnitId | WorkUnitId;

export type PlacementTraceEntry = {
    readonly activeUnit: TraceWorkUnitId | null;
    readonly kind: 'worker-crashed';
    readonly workerId: string;
} | {
    readonly authoritativeWorkerId: string;
    readonly conflictingWorkerId: string;
    readonly kind: 'hedged-duplicate-conflict';
    readonly unit: TraceWorkUnitId;
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
} | {
    readonly durationMicroseconds: number;
    readonly kind: 'unit-completed';
    readonly unit: TraceWorkUnitId;
    readonly workerId: string;
} | {
    readonly envelopeId: string;
    readonly kind: 'batch-completed';
    readonly lane: PlacementLane['id'];
    readonly units: NonEmptyReadonlyArray<TraceWorkUnitId>;
    readonly workerId: string;
} | {
    readonly envelopeId: string;
    readonly kind: 'batch-started';
    readonly lane: PlacementLane['id'];
    readonly units: NonEmptyReadonlyArray<TraceWorkUnitId>;
    readonly workerId: string;
} | {
    readonly fromLane: PlacementLane['id'];
    readonly kind: 'unit-reassigned';
    readonly toLane: PlacementLane['id'];
    readonly unit: TraceWorkUnitId;
} | {
    readonly kind: 'hedged-duplicate-discarded';
    readonly unit: TraceWorkUnitId;
    readonly workerId: string;
} | {
    readonly kind: 'hedged-duplicate-started';
    readonly unit: TraceWorkUnitId;
    readonly workerId: string;
} | {
    readonly kind: 'unit-started';
    readonly lane: PlacementLane['id'];
    readonly unit: TraceWorkUnitId;
    readonly workerId: string;
};

export function traceUnitKey(unit: TraceWorkUnitId): string {
    return JSON.stringify(unit);
}
