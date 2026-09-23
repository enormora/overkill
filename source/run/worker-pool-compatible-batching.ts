import type { StoredRunValue } from './supervised-run-state.ts';
import type { WorkUnit } from './run-types.ts';
import type { QueuedWorkUnit } from './worker-pool-pending-splitting.ts';
import type {
    LeaseReservation,
    WorkerPoolLeaseMember,
    WorkUnitQueue
} from './worker-pool-dispatch-state.ts';

export type CompatibleBatchingState = {
    readonly batchId: StoredRunValue<number>;
    readonly pendingUnits: WorkUnitQueue<QueuedWorkUnit>;
};

export type CompatibleBatchingDependencies = {
    readonly comparePriority: (left: QueuedWorkUnit, right: QueuedWorkUnit) => number;
    readonly compatibleLaneCount: (item: QueuedWorkUnit) => number;
    readonly laneCanLease: (item: QueuedWorkUnit) => boolean;
    readonly reserve: (member: QueuedWorkUnit) => LeaseReservation;
};

export type CompatibleBatchLeaseParts = {
    readonly envelopeId: string | null;
    readonly members: readonly [QueuedWorkUnit, ...readonly QueuedWorkUnit[]];
    readonly reservation: LeaseReservation;
    readonly leaseMembers: readonly [WorkerPoolLeaseMember, ...readonly WorkerPoolLeaseMember[]];
};

function uniqueText(values: readonly string[]): readonly string[] {
    return Array.from(new Set(values));
}

function stableText(values: readonly string[]): readonly string[] {
    return uniqueText(values).toSorted(function compareText(left, right) {
        return left.localeCompare(right);
    });
}

function workFile(work: WorkUnit['work'][number]): string | null {
    return work.case.file;
}

function unitPathEnvelope(unit: WorkUnit): readonly (string | null)[] {
    return Array.from(new Set(unit.work.map(workFile))).toSorted(function compareFile(left, right) {
        return String(left).localeCompare(String(right));
    });
}

function resourceConstraintEnvelope(unit: WorkUnit): unknown {
    return {
        affinityKeys: stableText(unit.resourceConstraints.affinityKeys),
        capacityWeight: unit.resourceConstraints.capacityWeight,
        duplicateExecution: stableText(unit.resourceConstraints.duplicateExecution),
        faultDomains: stableText(unit.resourceConstraints.faultDomains),
        serialKeys: stableText(unit.resourceConstraints.serialKeys),
        singleWorkerKeys: stableText(unit.resourceConstraints.singleWorkerKeys)
    };
}

function executionEnvelopeKey(unit: WorkUnit): string {
    return JSON.stringify({
        paths: unitPathEnvelope(unit),
        resourceConstraints: resourceConstraintEnvelope(unit),
        runtimes: unit.id.runtimes,
        scheduling: unit.scheduling,
        workerLifecycle: unit.workerLifecycle,
        workload: unit.id.workload
    });
}

function batchableItem(item: QueuedWorkUnit): boolean {
    return item.unit.workerLifecycle === 'reuse';
}

function batchCompatibleCandidates(
    state: CompatibleBatchingState,
    item: QueuedWorkUnit,
    dependencies: CompatibleBatchingDependencies
): readonly QueuedWorkUnit[] {
    const envelope = executionEnvelopeKey(item.unit);

    return state
        .pendingUnits
        .all()
        .filter(function isCompatible(candidate) {
            return candidate !== item &&
                batchableItem(candidate) &&
                dependencies.laneCanLease(candidate) &&
                executionEnvelopeKey(candidate.unit) === envelope;
        })
        .toSorted(dependencies.comparePriority);
}

function batchSizeLimit(
    state: CompatibleBatchingState,
    item: QueuedWorkUnit,
    dependencies: CompatibleBatchingDependencies
): number {
    const compatibleLanes = dependencies.compatibleLaneCount(item);

    if (compatibleLanes <= 1) {
        return Number.MAX_SAFE_INTEGER;
    }

    const matchingPendingCount = state
        .pendingUnits
        .all()
        .filter(function matchesEnvelope(candidate) {
            return batchableItem(candidate) &&
                dependencies.laneCanLease(candidate) &&
                executionEnvelopeKey(candidate.unit) === executionEnvelopeKey(item.unit);
        })
        .length;

    return Math.max(1, Math.ceil(matchingPendingCount / compatibleLanes));
}

function batchMembers(
    state: CompatibleBatchingState,
    item: QueuedWorkUnit,
    dependencies: CompatibleBatchingDependencies
): readonly [QueuedWorkUnit, ...QueuedWorkUnit[]] {
    if (!batchableItem(item)) {
        return [ item ];
    }

    const limit = batchSizeLimit(state, item, dependencies);
    const candidates = batchCompatibleCandidates(state, item, dependencies)
        .slice(0, Math.max(0, limit - 1));

    return [ item, ...candidates ];
}

function nextBatchEnvelopeId(
    state: CompatibleBatchingState,
    members: readonly QueuedWorkUnit[]
): string | null {
    if (members.length === 1) {
        return null;
    }

    const id = state.batchId.read() + 1;

    state.batchId.write(id);

    return `batch-${id}`;
}

function reserveBatch(
    members: readonly [QueuedWorkUnit, ...QueuedWorkUnit[]],
    dependencies: CompatibleBatchingDependencies
): LeaseReservation {
    const reservations = members.map(dependencies.reserve);

    return {
        faultDomains: reservations.flatMap(function toFaultDomains(reservation) {
            return reservation.faultDomains;
        }),
        hardKeys: reservations.flatMap(function toHardKeys(reservation) {
            return reservation.hardKeys;
        })
    };
}

function leaseMembers(
    members: readonly [QueuedWorkUnit, ...QueuedWorkUnit[]]
): CompatibleBatchLeaseParts['leaseMembers'] {
    const [ firstMember, ...restMembers ] = members;

    return [
        { traceUnit: firstMember.traceUnit, unit: firstMember.unit },
        ...restMembers.map(function toMember(member) {
            return { traceUnit: member.traceUnit, unit: member.unit };
        })
    ];
}

export function compatibleBatchLeaseParts(
    state: CompatibleBatchingState,
    item: QueuedWorkUnit,
    dependencies: CompatibleBatchingDependencies
): CompatibleBatchLeaseParts {
    const members = batchMembers(state, item, dependencies);

    return {
        envelopeId: nextBatchEnvelopeId(state, members),
        leaseMembers: leaseMembers(members),
        members,
        reservation: reserveBatch(members, dependencies)
    };
}
