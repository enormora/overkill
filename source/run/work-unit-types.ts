import type { NonEmptyReadonlyArray } from '../assertion-protocol/assertion-node-shape.ts';
import type { RunOrder, Scheduling, WorkerLifecycle, ProcessModel } from '../config/types.ts';
import type { RuntimeId, WorkloadId, WorkId, TestFamilyId } from './run-engine-primitives.ts';
import type { ResourceOwnershipPlan } from './resource-ownership-plan.ts';

export type WorkUnitMode = 'case' | 'file' | 'group';

export type WorkUnitId = {
    readonly familyVariant: WorkId['familyVariant'];
    readonly key: string;
    readonly mode: WorkUnitMode;
    readonly runtimes: readonly RuntimeId[];
    readonly workload: WorkloadId | null;
};

export type WorkUnitResourceConstraints = {
    readonly affinityKeys: readonly string[];
    readonly capacityWeight: number;
    readonly duplicateExecution: readonly DuplicateExecutionSafety[];
    readonly faultDomains: readonly string[];
    readonly serialKeys: readonly string[];
    readonly singleWorkerKeys: readonly string[];
};

export type DuplicateExecutionSafety = 'disposable-isolated' | 'idempotent';

export type WorkUnit = {
    readonly group: string | null;
    readonly id: WorkUnitId;
    readonly order: RunOrder;
    readonly resourceConstraints: WorkUnitResourceConstraints;
    readonly scheduling: Scheduling;
    readonly work: NonEmptyReadonlyArray<WorkId>;
    readonly workerLifecycle: WorkerLifecycle;
};

export type ExecutorDescriptor = {
    readonly capabilities: readonly string[];
    readonly capacity: number;
    readonly id: string;
    readonly kind: 'browser' | 'local-process' | 'local-worker' | 'remote';
};

export type PlacementLane = {
    readonly executor: ExecutorDescriptor;
    readonly id: string;
};

export type PlacementAssignment = {
    readonly lane: PlacementLane['id'];
    readonly unit: WorkUnitId;
};

export type PlacementPlan = {
    readonly assignments: readonly PlacementAssignment[];
    readonly lanes: readonly PlacementLane[];
    readonly resourceOwnership: ResourceOwnershipPlan;
    readonly units: readonly WorkUnit[];
};

export type DurationHistoryObservation = {
    readonly durationMicroseconds: number;
    readonly metadata: {
        readonly processModel: ProcessModel;
        readonly profile: string;
        readonly scheduling: Scheduling;
        readonly testFamily: TestFamilyId;
        readonly workerLifecycle: WorkerLifecycle | null;
    };
    readonly observedAt: string;
};
export type DurationHistorySample = {
    readonly durationMicroseconds: number;
    readonly observedAt: string;
    readonly observations: readonly DurationHistoryObservation[];
    readonly sampleCount: number;
    readonly work: WorkId;
};
export type DurationHistoryInput = {
    readonly generatedAt: string;
    readonly samples: readonly DurationHistorySample[];
    readonly source: 'runtime-state-index';
};
