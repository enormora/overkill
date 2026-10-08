import {
    MessageChannel as NodeMessageChannel,
    type MessagePort as NodeMessagePort
} from 'node:worker_threads';
import type { RunTimingSpan } from '../engine/run-timings.ts';
import type {
    HostProcess,
    IntegrationProfileConfig,
    MaxConcurrency,
    ResourceBudgets,
    Scheduling
} from '../config/types.ts';
import type { AttemptId, ReporterEvent, WorkId, RunnerError, RunResult } from './run-engine-primitives.ts';
import type { AttachmentEndpoint } from './attachment-protocol.ts';
import type { DefinitionLocationCapture } from './definition-location-capture.ts';
import type { PlacementAttemptId, PlacementWorkerId, TraceWorkUnitId } from './placement-trace.ts';
import type { CollectedRunPlan, RunCommand, RunCollectionRoot, RunTestFamily } from './run-types.ts';
import type {
    ResourceBoundaryUseCount
} from './resource-lifecycle-boundaries.ts';
import type {
    ResourceProjectionRecords
} from './resource-lifecycle-projection.ts';

type RunEngineSelection = RunCommand['engine'];

export type WorkerPoolCommand = {
    readonly attachmentEndpoint: AttachmentEndpoint | null;
    readonly retryPolicy: IntegrationProfileConfig['retries'];
    readonly collectionTimeoutMilliseconds: number;
    readonly cwd: string;
    readonly definitionLocationCapture: DefinitionLocationCapture;
    readonly engine: Exclude<RunEngineSelection, { readonly kind: 'instance'; }>;
    readonly hardTimeoutMilliseconds: number;
    readonly hostProcess: HostProcess;
    readonly maxConcurrency: MaxConcurrency;
    readonly paths: readonly string[];
    readonly resourceBudgets: ResourceBudgets;
    readonly resourceUsageSamplingIntervalMilliseconds: number;
    readonly root: RunCollectionRoot;
    readonly scheduling: Scheduling;
    readonly testFamily: RunTestFamily;
    readonly timeoutMilliseconds: number;
    readonly workerLifecycle: 'fresh-worker-per-unit' | 'reuse';
};

export const workerPoolRunResourceOwnerLane = 'run-resource-owner';

export type WorkerPoolAssignedUnit = {
    readonly attempt: PlacementAttemptId;
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
    readonly boundaryKeys: readonly string[];
    readonly boundaryUseCounts: readonly ResourceBoundaryUseCount[];
    readonly command: WorkerPoolCommand;
    readonly kind: 'acquire-run-resources';
    readonly lane: string;
    readonly lifecycle: WorkerPoolLifecycleIdentity;
    readonly port: NodeMessagePort;
};

export type WorkerPoolCompleteResourceOwnerWorkTask = {
    readonly boundaryKeys: readonly string[];
    readonly kind: 'complete-resource-owner-work';
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

export type WorkerPoolPrepareResourcesTask = {
    readonly kind: 'prepare-resource-artifacts';
    readonly work: WorkId;
    readonly attempt: AttemptId;
    readonly lane: string;
    readonly lifecycle: WorkerPoolLifecycleIdentity;
    readonly attachmentEndpoint: AttachmentEndpoint | null;
    readonly port: NodeMessagePort;
};
export type WorkerPoolPreparationReply = {
    readonly kind: 'resource-artifacts-prepared';
    readonly request: string;
    readonly runnerErrors: readonly RunnerError[];
};
type WorkerPoolTasksByKind = {
    readonly prepareResources: WorkerPoolPrepareResourcesTask;
    readonly acquireRunResources: WorkerPoolAcquireRunResourcesTask;
    readonly collect: WorkerPoolCollectTask;
    readonly completeResourceOwnerWork: WorkerPoolCompleteResourceOwnerWorkTask;
    readonly disposeLaneLifecycle: WorkerPoolDisposeLaneLifecycleTask;
    readonly disposeRunResources: WorkerPoolDisposeRunResourcesTask;
    readonly run: WorkerPoolRunTask;
};

export type WorkerPoolTask = WorkerPoolTasksByKind[keyof WorkerPoolTasksByKind];

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
    readonly attempt: PlacementAttemptId;
    readonly durationMicroseconds: number;
    readonly kind: 'attempt-completed';
};

type WorkerPoolUnitStartedMessage = {
    readonly attempt: PlacementAttemptId;
    readonly kind: 'attempt-started';
    readonly workerId: PlacementWorkerId;
};

type WorkerPoolTimingMessage = {
    readonly kind: 'timing';
    readonly span: RunTimingSpan;
};

type WorkerPoolTaskMessagesCompleted = {
    readonly kind: 'task-messages-completed';
};

type WorkerPoolMessagesByKind = {
    readonly prepareResources: {
        readonly kind: 'prepare-resource-artifacts';
        readonly request: string;
        readonly work: WorkId;
        readonly attempt: AttemptId;
    };
    readonly event: WorkerPoolReporterMessage;
    readonly output: WorkerPoolOutputMessage;
    readonly timing: WorkerPoolTimingMessage;
    readonly attemptCompleted: WorkerPoolUnitCompletedMessage;
    readonly attemptStarted: WorkerPoolUnitStartedMessage;
    readonly taskMessagesCompleted: WorkerPoolTaskMessagesCompleted;
};

export type WorkerPoolMessage = WorkerPoolMessagesByKind[keyof WorkerPoolMessagesByKind];

export type WorkerPoolMessageChannel = {
    readonly reply: (reply: WorkerPoolPreparationReply) => void;
    readonly close: () => void;
    readonly messagesCompleted: Promise<undefined>;
    readonly port: NodeMessagePort;
};

export function createWorkerPoolMessageChannel(
    receiveMessage: (message: WorkerPoolMessage) => void
): WorkerPoolMessageChannel {
    const { port1, port2 } = new NodeMessageChannel();
    const messagesCompleted = Promise.withResolvers<undefined>();

    port2.on('message', function receiveWorkerMessage(message: WorkerPoolMessage) {
        receiveMessage(message);

        if (message.kind === 'task-messages-completed') {
            messagesCompleted.resolve(undefined);
        }
    });

    return {
        reply(reply) {
            port2.postMessage(reply, []);
        },
        close() {
            port1.close();
            port2.close();
        },
        messagesCompleted: messagesCompleted.promise,
        port: port1
    };
}

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
