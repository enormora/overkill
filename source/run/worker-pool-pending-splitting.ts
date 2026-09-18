import { workIdentityKey } from '../engine/identity.ts';
import type { DynamicWorkUnitId, PlacementTraceEntry, TraceWorkUnitId } from './placement-trace-types.ts';
import type { WorkUnit } from './run-types.ts';
import type { WorkerPoolRunRuntime } from './worker-pool-runtime.ts';
import { workResourceConstraints } from './work-unit-resource-constraints.ts';

export type QueuePriority = {
    readonly childOrder: number;
    readonly parentOrder: number;
};

export type QueuedWorkUnit = {
    readonly priority: QueuePriority;
    readonly split: 'eligible-original' | 'fixed';
    readonly traceUnit: TraceWorkUnitId;
    readonly unit: WorkUnit;
};

export type SplitEligibility = {
    readonly compatibleLaneCount: number;
    readonly hardConstraintCount: number;
};

type SplitQueuedWorkUnit = QueuedWorkUnit & {
    readonly traceUnit: DynamicWorkUnitId;
};
type SplitQueuedWorkUnitResult = {
    readonly children: readonly QueuedWorkUnit[];
    readonly traceEntry: PlacementTraceEntry;
};

const requeuedParentOrder = Number.MAX_SAFE_INTEGER;

export function traceUnitKey(unit: TraceWorkUnitId): string {
    return JSON.stringify(unit);
}

function queuePriority(parentOrder: number, childOrder: number): QueuePriority {
    return { childOrder, parentOrder };
}

export function originalQueueItem(unit: WorkUnit, parentOrder: number): QueuedWorkUnit {
    return {
        priority: queuePriority(parentOrder, 0),
        split: 'eligible-original',
        traceUnit: unit.id,
        unit
    };
}

export function fixedQueueItem(
    unit: WorkUnit,
    traceUnit: TraceWorkUnitId,
    priority: QueuePriority
): QueuedWorkUnit {
    return {
        priority,
        split: 'fixed',
        traceUnit,
        unit
    };
}

export function requeuedPriority(): QueuePriority {
    return queuePriority(requeuedParentOrder, 0);
}

export function compareQueuePriority(left: QueuePriority, right: QueuePriority): number {
    const parentDifference = left.parentOrder - right.parentOrder;

    return parentDifference === 0 ? left.childOrder - right.childOrder : parentDifference;
}

function splitChildId(parent: WorkUnit, work: WorkUnit['work'][number]): DynamicWorkUnitId {
    return {
        child: workIdentityKey(work),
        parent: parent.id
    };
}

function splitChildUnits(runtime: WorkerPoolRunRuntime, item: QueuedWorkUnit): readonly SplitQueuedWorkUnit[] {
    return item.unit.work.map(function toChild(work, index) {
        const traceUnit = splitChildId(item.unit, work);
        const priority = queuePriority(item.priority.parentOrder, index);
        const child: SplitQueuedWorkUnit = {
            ...fixedQueueItem(
                {
                    ...item.unit,
                    resourceConstraints: workResourceConstraints([ work ], runtime.collectedPlan),
                    work: [ work ]
                },
                traceUnit,
                priority
            ),
            traceUnit
        };

        return child;
    });
}

function queuedWorkHasSplitShape(item: QueuedWorkUnit): boolean {
    return item.split === 'eligible-original' &&
        item.unit.work.length > 1 &&
        item.unit.id.mode !== 'group' &&
        item.unit.scheduling === 'concurrent' &&
        item.unit.workerLifecycle === 'reuse';
}

export function queuedWorkCanSplit(item: QueuedWorkUnit, eligibility: SplitEligibility): boolean {
    return queuedWorkHasSplitShape(item) &&
        eligibility.hardConstraintCount === 0 &&
        eligibility.compatibleLaneCount > 1;
}

export function splitQueuedWorkUnit(
    runtime: WorkerPoolRunRuntime,
    item: QueuedWorkUnit
): SplitQueuedWorkUnitResult {
    const children = splitChildUnits(runtime, item);
    const firstChild = children[0];

    if (firstChild === undefined) {
        throw new Error('Splittable work unit unexpectedly had no children.');
    }

    return {
        children,
        traceEntry: {
            children: [
                firstChild.traceUnit,
                ...children.slice(1).map(function toTraceUnit(child) {
                    return child.traceUnit;
                })
            ],
            kind: 'unit-split',
            parent: item.unit.id
        }
    };
}
