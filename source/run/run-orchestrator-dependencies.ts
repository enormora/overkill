import type { HostProcess } from '../config/types.ts';
import type {
    HistoryMaintenance,
    HistoryStorageFactory,
    RuntimeStateStore
} from './history-storage-types.ts';
import type { RunHostObservations, ProcessUsageTrackerOptions } from './run-host-observations.ts';
import type {
    TestFamilyId,
    Execute,
    Engine,
    ReporterDispatcher,
    RunnerError,
    RunProcessUsageTracker
} from './run-engine-primitives.ts';
import type {
    RuntimeCapabilityPolicyDependencies,
    RuntimeCapabilityPolicyEnvironment
} from './capability-policy-snapshots.ts';
import type { RunDiscovery } from './run-discovery-types.ts';
import type { RunEngineModuleLoader } from './run-engine-selection.ts';
import type { RunTestModuleLoader } from './run-test-modules.ts';
import type { RunTimingMeasurement } from './run-timing-collection.ts';
import type {
    SupervisedChildProcess,
    SupervisedChildProcessStarter
} from './supervised-child-process.ts';

export type WorkerPoolProcessUsageTracker = RunProcessUsageTracker & {
    readonly waitForStart?: () => Promise<void>;
};

export type WorkerPoolHostOutputSink = (
    stream: 'stderr' | 'stdout',
    chunk: Uint8Array
) => void;

export type WorkerPoolCreationOptions = {
    readonly cwd: string;
    readonly hostProcess: HostProcess;
    readonly testFamily: TestFamilyId;
    readonly timing?: RunTimingMeasurement | null;
    readonly workerCount: number;
    readonly workerLifecycle: 'fresh-worker-per-unit' | 'reuse';
};

export type WorkerPoolHostProcessStartOptions = {
    readonly cwd: string;
    readonly environmentVariables: RuntimeCapabilityPolicyEnvironment;
    readonly nodeArguments: readonly string[];
    readonly testFamily: TestFamilyId;
};

export type WorkerPoolHostProcessStarter = (
    options: WorkerPoolHostProcessStartOptions
) => SupervisedChildProcess;

type WorkerPoolRunOptions = {
    readonly name: string;
    readonly signal: AbortSignal;
    readonly transferList: readonly unknown[];
};

export type CreatedWorkerPool = {
    readonly createProcessUsageTracker?: (options: ProcessUsageTrackerOptions) => WorkerPoolProcessUsageTracker;
    readonly destroy: () => Promise<void>;
    readonly options: {
        readonly isolateWorkers: boolean;
        readonly maxThreads: number;
    };
    run: (task: unknown, options: WorkerPoolRunOptions) => Promise<unknown>;
    readonly setHostOutputSink?: (sink: WorkerPoolHostOutputSink | null) => void;
    readonly takeHostRunnerErrors?: () => readonly RunnerError[];
};

export type HostRunnerErrors = {
    readonly push: (error: RunnerError) => unknown;
    readonly take: () => readonly RunnerError[];
};

export function createHostRunnerErrors(): HostRunnerErrors {
    const errors: RunnerError[] = [];

    return {
        push(error) {
            errors.push(error);
        },
        take() {
            const currentErrors = Array.from(errors);

            errors.length = 0;

            return currentErrors;
        }
    };
}

export type RunOrchestratorDependencies = RunHostObservations & {
    readonly createHistoryStorage: HistoryStorageFactory;
    readonly maintainHistory: HistoryMaintenance;
    readonly createSeed: () => bigint;
    readonly createWorkerPool: (options: WorkerPoolCreationOptions) => CreatedWorkerPool;
    readonly defaultEngine: Engine;
    readonly discoverRunFilesWithProjectRoot: RunDiscovery['discoverRunFilesWithProjectRoot'];
    readonly runtimeStateStore: RuntimeStateStore;
    readonly createExecution: (reporterDispatcher: ReporterDispatcher) => Execute;
    readonly execute: Execute;
    readonly loadRunEngineModule: RunEngineModuleLoader;
    readonly loadRunTestModules: RunTestModuleLoader;
    readonly liveOutput: {
        readonly stderr: {
            readonly write: (chunk: Uint8Array) => void;
        };
        readonly stdout: {
            readonly write: (chunk: Uint8Array) => void;
        };
    };
    readonly runtimeCapabilityPolicy: RuntimeCapabilityPolicyDependencies;
    readonly reporterDispatcher: ReporterDispatcher;
    readonly startSupervisedChild: SupervisedChildProcessStarter;
    readonly startWorkerPoolHost: WorkerPoolHostProcessStarter;
};
