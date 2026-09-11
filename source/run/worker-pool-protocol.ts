import type { MessagePort as NodeMessagePort } from 'node:worker_threads';
import type { CaseId } from '../engine/identity.ts';
import type { ReporterEvent } from '../engine/reporter.ts';
import type {
    RunnerError,
    RunResult
} from '../engine/run-result.ts';
import type {
    CollectedRunPlan,
    RunEngineSelection,
    RunResourceBudgets,
    RunScheduling,
    RunTestFamily
} from './run-types.ts';

export type WorkerPoolCommand = {
    readonly collectionTimeoutMilliseconds: number;
    readonly cwd: string;
    readonly engine: Exclude<RunEngineSelection, { readonly kind: 'instance'; }>;
    readonly hardTimeoutMilliseconds: number;
    readonly paths: readonly string[];
    readonly resourceBudgets: RunResourceBudgets;
    readonly resourceUsageSamplingIntervalMilliseconds: number;
    readonly scheduling: RunScheduling;
    readonly testFamily: RunTestFamily;
    readonly timeoutMilliseconds: number;
};

type WorkerPoolCollectTask = {
    readonly command: WorkerPoolCommand;
    readonly kind: 'collect';
    readonly port: NodeMessagePort;
};

export type WorkerPoolRunTask = {
    readonly assignedCases: readonly CaseId[];
    readonly command: WorkerPoolCommand;
    readonly kind: 'run';
    readonly port: NodeMessagePort;
    readonly startedAtMilliseconds: number;
};

export type WorkerPoolTask = WorkerPoolCollectTask | WorkerPoolRunTask;

type WorkerPoolOutputMessage = {
    readonly capturedAtMilliseconds: number;
    readonly chunk: Uint8Array;
    readonly kind: 'output';
    readonly stream: 'stderr' | 'stdout';
};

type WorkerPoolReporterMessage = {
    readonly event: ReporterEvent;
    readonly kind: 'event';
};

export type WorkerPoolMessage = WorkerPoolOutputMessage | WorkerPoolReporterMessage;

export type WorkerPoolCollection = {
    readonly collectedPlan: CollectedRunPlan;
    readonly runnerErrors: readonly RunnerError[];
};

export type WorkerPoolRunOutput = {
    readonly result: RunResult;
};
