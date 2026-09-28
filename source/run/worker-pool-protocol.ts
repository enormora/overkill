import type { MessagePort as NodeMessagePort } from 'node:worker_threads';
import type { ReporterEvent } from '../engine/reporter.ts';
import type { RunTimingSpan } from '../engine/run-timings.ts';
import type { WorkId } from '../engine/identity.ts';
import type {
    RunnerError,
    RunResult
} from '../engine/run-result.ts';
import type { DefinitionLocationCapture } from './definition-location-capture.ts';
import type { TraceWorkUnitId } from './placement-trace.ts';
import type {
    CollectedRunPlan,
    RunEngineSelection,
    RunHostProcess,
    RunResourceBudgets,
    RunScheduling,
    RunTestFamily
} from './run-types.ts';
import type {
    ResourceBoundaryUseCount,
    ResourceProjectionRecords
} from './resource-lifecycle.ts';

export type WorkerPoolCommand = {
    readonly collectionTimeoutMilliseconds: number;
    readonly cwd: string;
    readonly definitionLocationCapture: DefinitionLocationCapture;
    readonly engine: Exclude<RunEngineSelection, { readonly kind: 'instance'; }>;
    readonly hardTimeoutMilliseconds: number;
    readonly hostProcess: RunHostProcess;
    readonly paths: readonly string[];
    readonly resourceBudgets: RunResourceBudgets;
    readonly resourceUsageSamplingIntervalMilliseconds: number;
    readonly scheduling: RunScheduling;
    readonly testFamily: RunTestFamily;
    readonly timeoutMilliseconds: number;
    readonly workerLifecycle: 'fresh-worker-per-unit' | 'reuse';
};

export const workerPoolRunResourceOwnerLane = 'run-resource-owner';

export type WorkerPoolAssignedUnit = {
    readonly traceUnit: TraceWorkUnitId;
    readonly work: readonly WorkId[];
};

type WorkerPoolCollectTask = {
    readonly command: WorkerPoolCommand;
    readonly kind: 'collect';
    readonly port: NodeMessagePort;
};

export type WorkerPoolLifecycleIdentity = {
    readonly token: string;
};

export type WorkerPoolRunTask = {
    readonly assignedUnits: readonly WorkerPoolAssignedUnit[];
    readonly assignedWork: readonly WorkId[];
    readonly boundaryUseCounts: readonly ResourceBoundaryUseCount[];
    readonly command: WorkerPoolCommand;
    readonly kind: 'run';
    readonly lane: string;
    readonly lifecycle: WorkerPoolLifecycleIdentity;
    readonly port: NodeMessagePort;
    readonly projectedResources: ResourceProjectionRecords;
    readonly runWork: readonly WorkId[];
    readonly startedAtMilliseconds: number;
};

export type WorkerPoolAcquireRunResourcesTask = {
    readonly assignedWork: readonly WorkId[];
    readonly boundaryUseCounts: readonly ResourceBoundaryUseCount[];
    readonly command: WorkerPoolCommand;
    readonly kind: 'acquire-run-resources';
    readonly lane: string;
    readonly lifecycle: WorkerPoolLifecycleIdentity;
    readonly port: NodeMessagePort;
};

export type WorkerPoolDisposeRunResourcesTask = {
    readonly kind: 'dispose-run-resources';
    readonly lane: string;
    readonly lifecycle: WorkerPoolLifecycleIdentity;
    readonly port: NodeMessagePort;
};

export type WorkerPoolDisposeLaneLifecycleTask = {
    readonly kind: 'dispose-lane-lifecycle';
    readonly lane: string;
    readonly lifecycle: WorkerPoolLifecycleIdentity;
    readonly port: NodeMessagePort;
};

export type WorkerPoolTask =
    | WorkerPoolAcquireRunResourcesTask
    | WorkerPoolCollectTask
    | WorkerPoolDisposeLaneLifecycleTask
    | WorkerPoolDisposeRunResourcesTask
    | WorkerPoolRunTask;

type WorkerPoolOutputMessage = {
    readonly capturedAtMicroseconds: number;
    readonly chunk: Uint8Array;
    readonly kind: 'output';
    readonly stream: 'stderr' | 'stdout';
};

type WorkerPoolReporterMessage = {
    readonly event: ReporterEvent;
    readonly kind: 'event';
};

type WorkerPoolUnitCompletedMessage = {
    readonly durationMicroseconds: number;
    readonly kind: 'unit-completed';
    readonly traceUnit: TraceWorkUnitId;
};

type WorkerPoolUnitStartedMessage = {
    readonly kind: 'unit-started';
    readonly traceUnit: TraceWorkUnitId;
};

type WorkerPoolTimingMessage = {
    readonly kind: 'timing';
    readonly span: RunTimingSpan;
};

type WorkerPoolMessagesByKind = {
    readonly event: WorkerPoolReporterMessage;
    readonly output: WorkerPoolOutputMessage;
    readonly timing: WorkerPoolTimingMessage;
    readonly unitCompleted: WorkerPoolUnitCompletedMessage;
    readonly unitStarted: WorkerPoolUnitStartedMessage;
};

export type WorkerPoolMessage = WorkerPoolMessagesByKind[keyof WorkerPoolMessagesByKind];

export type WorkerPoolCollection = {
    readonly collectedPlan: CollectedRunPlan;
    readonly runnerErrors: readonly RunnerError[];
};

export type WorkerPoolRunOutput = {
    readonly results: readonly {
        readonly result: RunResult;
        readonly traceUnit: TraceWorkUnitId;
    }[];
};

export type WorkerPoolRunResourceOutput = {
    readonly projectedResources: ResourceProjectionRecords;
    readonly runnerErrors: readonly RunnerError[];
};

export type WorkerPoolDisposeResourceOutput = {
    readonly runnerErrors: readonly RunnerError[];
};
