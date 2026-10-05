import type { TestRetryPolicy } from '../engine/retry-policy.ts';
import type { ResourceOwnershipPlan } from './resource-ownership-plan.ts';

export type RetryArtifactPolicy = 'all' | 'first-failure-and-final' | 'last-failure-and-final';
export type IntegrationRetryPolicy = TestRetryPolicy & { readonly artifacts: RetryArtifactPolicy; };

export type RunExecutionResourceOwnershipPlan = ResourceOwnershipPlan;
type Either<First, Second> = First | Second;

export type RunMicrotestExecutionShape<MaxConcurrency, ProcessModel, Scheduling> = {
    readonly maxConcurrency: MaxConcurrency;
    readonly processModel: ProcessModel;
    readonly scheduling: Scheduling;
};

type RunSupervisedIntegrationExecution<MaxConcurrency, Scheduling> = {
    readonly maxConcurrency: MaxConcurrency;
    readonly processModel: 'supervised-process';
    readonly scheduling: Scheduling;
};

type RunWorkerPoolExecution<
    AssignmentPolicy,
    DispatchPolicy,
    HedgingPolicy,
    HostProcess,
    MaxConcurrency,
    Scheduling,
    WorkerLifecycle,
    WorkDistribution
> = {
    readonly assignmentPolicy: AssignmentPolicy;
    readonly dispatchPolicy: DispatchPolicy;
    readonly hedging: HedgingPolicy;
    readonly hostProcess: HostProcess;
    readonly maxConcurrency: MaxConcurrency;
    readonly maxWorkers: number | null;
    readonly processModel: 'worker-pool';
    readonly scheduling: Scheduling;
    readonly workerLifecycle: WorkerLifecycle;
    readonly workDistribution: WorkDistribution;
};

export type RunIntegrationExecutionShape<
    AssignmentPolicy,
    DispatchPolicy,
    HedgingPolicy,
    HostProcess,
    MaxConcurrency,
    Scheduling,
    WorkerLifecycle,
    WorkDistribution
> = Either<
    RunSupervisedIntegrationExecution<MaxConcurrency, Scheduling>,
    RunWorkerPoolExecution<
        AssignmentPolicy,
        DispatchPolicy,
        HedgingPolicy,
        HostProcess,
        MaxConcurrency,
        Scheduling,
        WorkerLifecycle,
        WorkDistribution
    >
>;
