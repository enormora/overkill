import { workIdentityKey } from '../engine/identity.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import type { PlacementLane, WorkUnit } from './run-types.ts';
import type { WorkerPoolUnitLease } from './worker-pool-dispatch-state.ts';
import type { WorkerPoolRunRuntime } from './worker-pool-runtime.ts';

export type HedgeActiveUnitLease = {
    readonly lane: PlacementLane;
    readonly lease: WorkerPoolUnitLease;
    readonly startedAtMilliseconds: number;
};

export type HedgeDispatchState = {
    readonly activeUnits: {
        readonly values: () => IterableIterator<HedgeActiveUnitLease>;
    };
    readonly duplicateWork: ReadonlySet<string>;
    readonly lifecycleByLane: ReadonlyMap<string, WorkUnit['workerLifecycle']>;
    readonly resolvedRun: WorkerPoolRunRuntime['resolvedRun'];
    readonly wallClock: RunOrchestratorDependencies['wallClock'];
};

export function unitHedgeWorkKey(unit: WorkUnit): string {
    return workIdentityKey(unit.work[0]);
}

function activeHedgeWorkKey(entry: HedgeActiveUnitLease): string {
    return unitHedgeWorkKey(entry.lease.unit);
}

function workDurationEstimate(state: HedgeDispatchState, workKey: string): number | null {
    const samples = state.resolvedRun.facts.durationHistory?.samples ?? [];
    const sample = samples.find(function hasWork(candidate) {
        return workIdentityKey(candidate.work) === workKey;
    });

    return sample?.durationMilliseconds ?? null;
}

function hedgeThresholdMilliseconds(state: HedgeDispatchState, entry: HedgeActiveUnitLease): number | null {
    const { execution } = state.resolvedRun.facts;

    if (execution.processModel !== 'worker-pool' || execution.hedging.mode === 'off') {
        return null;
    }

    const estimate = workDurationEstimate(state, activeHedgeWorkKey(entry));

    return Math.max(
        execution.hedging.minimumDelayMilliseconds,
        estimate === null ? execution.hedging.minimumDelayMilliseconds : estimate * execution.hedging.durationMultiplier
    );
}

function elapsedMilliseconds(state: HedgeDispatchState, entry: HedgeActiveUnitLease): number {
    return state.wallClock.currentTimestampInMilliseconds - entry.startedAtMilliseconds;
}

function unitIsHedgeSafe(unit: WorkUnit): boolean {
    if (unit.resourceConstraints.duplicateExecution.includes('idempotent')) {
        return true;
    }

    return unit.workerLifecycle === 'fresh-worker-per-unit' &&
        unit.resourceConstraints.duplicateExecution.includes('disposable-isolated');
}

function unitHasNoHardConstraints(unit: WorkUnit): boolean {
    return unit.resourceConstraints.serialKeys.length === 0 &&
        unit.resourceConstraints.singleWorkerKeys.length === 0;
}

function hedgeCandidateCanRunOnLane(
    state: HedgeDispatchState,
    entry: HedgeActiveUnitLease,
    lane: PlacementLane
): boolean {
    return entry.lane.id !== lane.id &&
        state.lifecycleByLane.get(lane.id) === entry.lease.unit.workerLifecycle;
}

function hedgeCandidateIsEligible(state: HedgeDispatchState, entry: HedgeActiveUnitLease): boolean {
    return entry.lease.kind === 'primary' &&
        entry.lease.unit.work.length === 1 &&
        unitHasNoHardConstraints(entry.lease.unit) &&
        unitIsHedgeSafe(entry.lease.unit) &&
        !state.duplicateWork.has(activeHedgeWorkKey(entry));
}

function hedgeCandidateIsCompatible(
    state: HedgeDispatchState,
    entry: HedgeActiveUnitLease,
    lane: PlacementLane
): boolean {
    return hedgeCandidateIsEligible(state, entry) && hedgeCandidateCanRunOnLane(state, entry, lane);
}

function hedgeCandidateReady(state: HedgeDispatchState, entry: HedgeActiveUnitLease): boolean {
    const threshold = hedgeThresholdMilliseconds(state, entry);

    return threshold !== null && elapsedMilliseconds(state, entry) >= threshold;
}

function compatibleHedgeDelays(state: HedgeDispatchState, lane: PlacementLane): readonly number[] {
    return Array.from(state.activeUnits.values()).flatMap(function toDelay(entry) {
        if (!hedgeCandidateIsCompatible(state, entry, lane)) {
            return [];
        }

        const threshold = hedgeThresholdMilliseconds(state, entry);

        return threshold === null ? [] : [ Math.max(0, threshold - elapsedMilliseconds(state, entry)) ];
    });
}

export function hedgeWakeDelay(state: HedgeDispatchState, lane: PlacementLane): number | null {
    const delays = compatibleHedgeDelays(state, lane);

    return delays.length === 0 ? null : Math.min(...delays);
}

export function selectHedgeCandidate(
    state: HedgeDispatchState,
    lane: PlacementLane
): HedgeActiveUnitLease | null {
    return Array.from(state.activeUnits.values()).find(function canHedge(entry) {
        return hedgeCandidateIsCompatible(state, entry, lane) && hedgeCandidateReady(state, entry);
    }) ?? null;
}

export function laneHasPotentialHedge(state: HedgeDispatchState, lane: PlacementLane): boolean {
    return Array.from(state.activeUnits.values()).some(function canEventuallyHedge(entry) {
        return hedgeCandidateIsCompatible(state, entry, lane) && hedgeThresholdMilliseconds(state, entry) !== null;
    });
}
