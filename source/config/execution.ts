import type { TestRetryPolicy } from '../engine/retry-policy.ts';

export type RetryArtifactPolicy = 'all' | 'first-failure-and-final' | 'last-failure-and-final';
export type IntegrationRetryPolicy = TestRetryPolicy & { readonly artifacts: RetryArtifactPolicy; };

type Either<First, Second> = First | Second;

export type MicrotestExecutionShape<MaxConcurrency, ProcessModel, Scheduling> = {
    readonly maxConcurrency: MaxConcurrency;
    readonly processModel: ProcessModel;
    readonly scheduling: Scheduling;
};

type SupervisedIntegrationExecution<MaxConcurrency, Scheduling> = {
    readonly maxConcurrency: MaxConcurrency;
    readonly processModel: 'supervised-process';
    readonly scheduling: Scheduling;
};

type WorkerPoolExecution<
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

export type IntegrationExecutionShape<
    AssignmentPolicy,
    DispatchPolicy,
    HedgingPolicy,
    HostProcess,
    MaxConcurrency,
    Scheduling,
    WorkerLifecycle,
    WorkDistribution
> = Either<
    SupervisedIntegrationExecution<MaxConcurrency, Scheduling>,
    WorkerPoolExecution<
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
