import type { MessagePort as NodeMessagePort } from 'node:worker_threads';
import type { ReporterEvent } from '../engine/reporter.ts';
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

export type WorkerPoolAssignedUnit = {
    readonly traceUnit: TraceWorkUnitId;
    readonly work: readonly WorkId[];
};

type WorkerPoolCollectTask = {
    readonly command: WorkerPoolCommand;
    readonly kind: 'collect';
    readonly port: NodeMessagePort;
};

export type WorkerPoolRunTask = {
    readonly assignedUnits: readonly WorkerPoolAssignedUnit[];
    readonly assignedWork: readonly WorkId[];
    readonly command: WorkerPoolCommand;
    readonly kind: 'run';
    readonly lane: string;
    readonly port: NodeMessagePort;
    readonly startedAtMilliseconds: number;
};

export type WorkerPoolTask = WorkerPoolCollectTask | WorkerPoolRunTask;

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

type WorkerPoolMessagesByKind = {
    readonly event: WorkerPoolReporterMessage;
    readonly output: WorkerPoolOutputMessage;
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
