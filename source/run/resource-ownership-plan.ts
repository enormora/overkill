import type { NonEmptyReadonlyArray } from '../assertion-protocol/assertion-node-shape.ts';
import type { RuntimeId, WorkId, WorkloadId } from '../engine/identity.ts';

type ResourceOwnerWorkUnitId = {
    readonly key: string;
    readonly mode: 'case' | 'file' | 'group';
    readonly runtimes: readonly RuntimeId[];
    readonly workload: WorkloadId | null;
};

export type ResourceOwnerPlacement = {
    readonly id: 'resource-owner';
    readonly kind: 'infrastructure-worker';
} | {
    readonly kind: 'executor-lane';
    readonly lane: string;
} | {
    readonly kind: 'work-unit';
    readonly unit: ResourceOwnerWorkUnitId;
};

export type PlannedResourceOwner = {
    readonly boundaryKey: string;
    readonly placement: ResourceOwnerPlacement;
    readonly resourceName: string;
    readonly scope: 'per-file' | 'per-run' | 'per-suite';
    readonly work: NonEmptyReadonlyArray<WorkId>;
};

export type ResourceOwnershipPlan = {
    readonly owners: readonly PlannedResourceOwner[];
};
