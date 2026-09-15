import type { WallClock } from '@enormora/wall-clock';
import type {
    Engine,
    Execute,
    ReporterDispatcher,
    RunResourceUsageTracker
} from '../packages/engine/engine.entry-point.ts';
import type {
    RuntimeCapabilityPolicyDependencies,
    RuntimeCapabilityPolicyEnvironment
} from './capability-policy.ts';
import type { RunDiscovery } from './run-discovery-types.ts';
import type { RunEngineModuleLoader } from './run-engine-selection.ts';
import type { RunTestModuleLoader } from './run-test-modules.ts';
import type { RunHostProcess } from './run-types.ts';
import type {
    SupervisedChildProcess,
    SupervisedChildProcessStarter
} from './supervised-child-process.ts';

type ResourceUsageTrackerOptions = {
    readonly samplingIntervalMilliseconds: number;
};

export type WorkerPoolResourceUsageTracker = RunResourceUsageTracker & {
    readonly waitForStart?: () => Promise<void>;
};

export type WorkerPoolHostOutputSink = (
    stream: 'stderr' | 'stdout',
    chunk: Uint8Array
) => void;

export type WorkerPoolCreationOptions = {
    readonly cwd: string;
    readonly hostProcess: RunHostProcess;
    readonly workerCount: number;
    readonly workerLifecycle: 'fresh-worker-per-unit' | 'reuse';
};

export type WorkerPoolHostProcessStartOptions = {
    readonly cwd: string;
    readonly environmentVariables: RuntimeCapabilityPolicyEnvironment;
    readonly nodeArguments: readonly string[];
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
    readonly createResourceUsageTracker?: (options: ResourceUsageTrackerOptions) => WorkerPoolResourceUsageTracker;
    readonly destroy: () => Promise<void>;
    readonly options: {
        readonly isolateWorkers: boolean;
        readonly maxThreads: number;
    };
    run: (task: unknown, options: WorkerPoolRunOptions) => Promise<unknown>;
    readonly setHostOutputSink?: (sink: WorkerPoolHostOutputSink | null) => void;
};

export type RunOrchestratorDependencies = {
    readonly availableParallelism: number;
    readonly createSeed: () => bigint;
    readonly createResourceUsageTracker: (options: ResourceUsageTrackerOptions) => RunResourceUsageTracker;
    readonly createWorkerPool: (options: WorkerPoolCreationOptions) => CreatedWorkerPool;
    readonly defaultEngine: Engine;
    readonly discoverRunFilesWithProjectRoot: RunDiscovery['discoverRunFilesWithProjectRoot'];
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
    readonly node: {
        readonly arch: string;
        readonly platform: string;
        readonly version: string;
    };
    readonly reporterDispatcher: ReporterDispatcher;
    readonly startSupervisedChild: SupervisedChildProcessStarter;
    readonly startWorkerPoolHost: WorkerPoolHostProcessStarter;
    readonly wallClock: WallClock;
};
