import type { OverkillClock } from '../clock/overkill-clock.ts';
import type {
    Engine,
    Execute,
    ReporterDispatcher,
    RunnerError,
    RunResourceUsageTracker
} from '../packages/engine/engine.entry-point.ts';
import type {
    RuntimeCapabilityPolicyDependencies,
    RuntimeCapabilityPolicyEnvironment
} from './capability-policy-snapshots.ts';
import type { DurationHistoryStore } from './duration-history.ts';
import type { RunDiscovery } from './run-discovery-types.ts';
import type { RunEngineModuleLoader } from './run-engine-selection.ts';
import type { RunTestModuleLoader } from './run-test-modules.ts';
import type { RunHostProcess, RunTestFamily } from './run-types.ts';
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
    readonly testFamily: RunTestFamily;
    readonly workerCount: number;
    readonly workerLifecycle: 'fresh-worker-per-unit' | 'reuse';
};

export type WorkerPoolHostProcessStartOptions = {
    readonly cwd: string;
    readonly environmentVariables: RuntimeCapabilityPolicyEnvironment;
    readonly nodeArguments: readonly string[];
    readonly testFamily: RunTestFamily;
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

export type RunOrchestratorDependencies = {
    readonly availableParallelism: number;
    readonly createSeed: () => bigint;
    readonly createResourceUsageTracker: (options: ResourceUsageTrackerOptions) => RunResourceUsageTracker;
    readonly createWorkerPool: (options: WorkerPoolCreationOptions) => CreatedWorkerPool;
    readonly defaultEngine: Engine;
    readonly discoverRunFilesWithProjectRoot: RunDiscovery['discoverRunFilesWithProjectRoot'];
    readonly durationHistoryStore: DurationHistoryStore;
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
    readonly wallClock: OverkillClock;
};
