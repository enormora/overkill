import type { PlacementTraceEntry, TraceWorkUnitId } from './placement-trace.ts';
import type { PlacementLane } from './run-types.ts';
import { compatibleBatchLeaseParts as createCompatibleBatchLeaseParts } from './worker-pool-compatible-batching.ts';
import { compareQueuePriority, type QueuedWorkUnit } from './worker-pool-pending-splitting.ts';
import type { UnitLoad } from './worker-pool-work-load.ts';
import {
    createWarmLaneAffinity as createWarmLaneAffinityState,
    type WarmLaneAffinity as WarmLaneAffinityState,
    type WarmLaneAffinityMatch
} from './worker-pool-warm-lane-affinity.ts';

export type WarmLaneAffinity = WarmLaneAffinityState;

type WarmSelectedUnit = {
    readonly baseline: QueuedWorkUnit;
    readonly item: QueuedWorkUnit;
    readonly match: WarmLaneAffinityMatch;
    readonly window: readonly [QueuedWorkUnit, ...readonly QueuedWorkUnit[]];
};

export type WarmPendingSelection = {
    readonly item: QueuedWorkUnit;
    readonly traceEntry: PlacementTraceEntry | null;
};

export type WarmPendingSelectionInput = {
    readonly candidates: readonly [QueuedWorkUnit, ...readonly QueuedWorkUnit[]];
    readonly lane: PlacementLane;
    readonly laneCount: number;
    readonly unitLoad: UnitLoad;
    readonly warmLaneAffinity: WarmLaneAffinity;
};

const warmLookaheadLaneMultiplier = 2;

function compareWarmSelection(left: WarmSelectedUnit, right: WarmSelectedUnit): number {
    const scoreDifference = right.match.score - left.match.score;

    if (scoreDifference !== 0) {
        return scoreDifference;
    }

    return compareQueuePriority(left.item.priority, right.item.priority);
}

function topLoadWindow(input: WarmPendingSelectionInput): readonly [QueuedWorkUnit, ...readonly QueuedWorkUnit[]] {
    const topLoad = input.unitLoad(input.candidates[0].unit);
    const candidates = input
        .candidates
        .filter(function hasTopLoad(candidate) {
            return input.unitLoad(candidate.unit) === topLoad;
        })
        .slice(0, input.laneCount * warmLookaheadLaneMultiplier);
    const [ firstCandidate, ...remainingCandidates ] = candidates;

    if (firstCandidate === undefined) {
        throw new Error('Warm-lane selection requires a non-empty candidate window.');
    }

    return [ firstCandidate, ...remainingCandidates ];
}

function warmSelection(input: WarmPendingSelectionInput): WarmSelectedUnit {
    const window = topLoadWindow(input);
    const baseline = window[0];
    const selected = window
        .map(function toSelection(item): WarmSelectedUnit {
            return {
                baseline,
                item,
                match: input.warmLaneAffinity.match(input.lane, item.unit),
                window
            };
        })
        .toSorted(compareWarmSelection)[0];

    if (selected === undefined) {
        throw new Error('Warm-lane selection requires a non-empty candidate window.');
    }

    return selected.match.score === 0
        ? { baseline, item: baseline, match: selected.match, window }
        : selected;
}

function nonEmptyWarmKeyKinds(
    match: WarmLaneAffinityMatch
): [WarmLaneAffinityMatch['kinds'][number], ...WarmLaneAffinityMatch['kinds'][number][]] {
    const [ firstKind, ...restKinds ] = match.kinds;

    if (firstKind === undefined) {
        throw new Error('Warm-lane affinity selected a unit without matched warm keys.');
    }

    return [ firstKind, ...restKinds ];
}

function traceUnits(
    items: readonly [QueuedWorkUnit, ...readonly QueuedWorkUnit[]]
): [TraceWorkUnitId, ...TraceWorkUnitId[]] {
    return [
        items[0].traceUnit,
        ...items.slice(1).map(function toTraceUnit(item) {
            return item.traceUnit;
        })
    ];
}

function traceEntry(selection: WarmSelectedUnit, lane: PlacementLane): PlacementTraceEntry | null {
    if (selection.item === selection.baseline || selection.match.score === 0) {
        return null;
    }

    return {
        baselineUnit: selection.baseline.traceUnit,
        candidateUnits: traceUnits(selection.window),
        kind: 'warm-lane-affinity-selected',
        lane: lane.id,
        matchedWarmKeys: nonEmptyWarmKeyKinds(selection.match),
        score: selection.match.score,
        selectedUnit: selection.item.traceUnit
    };
}

export function selectWarmPendingUnit(input: WarmPendingSelectionInput): WarmPendingSelection {
    const selection = warmSelection(input);

    return {
        item: selection.item,
        traceEntry: traceEntry(selection, input.lane)
    };
}

export const compatibleBatchLeaseParts: typeof createCompatibleBatchLeaseParts = createCompatibleBatchLeaseParts;
export const createWarmLaneAffinity: typeof createWarmLaneAffinityState = createWarmLaneAffinityState;
