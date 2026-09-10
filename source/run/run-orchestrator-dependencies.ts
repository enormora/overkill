import type { WallClock } from '@enormora/wall-clock';
import type { Execute } from '../engine/execution.ts';
import type { Engine } from '../engine/engine.ts';
import type { ReporterDispatcher } from '../engine/reporter-dispatcher.ts';
import type { RunResourceUsageTracker } from '../engine/run-result.ts';
import type { RuntimeCapabilityPolicyDependencies } from './capability-policy.ts';
import type { RunDiscovery } from './run-discovery-types.ts';
import type { RunEngineModuleLoader } from './run-engine-selection.ts';
import type { RunTestModuleLoader } from './run-test-modules.ts';
import type { SupervisedChildProcessStarter } from './supervised-child-process.ts';

type ResourceUsageTrackerOptions = {
    readonly samplingIntervalMilliseconds: number;
};

export type RunOrchestratorDependencies = {
    readonly createSeed: () => bigint;
    readonly createResourceUsageTracker: (options: ResourceUsageTrackerOptions) => RunResourceUsageTracker;
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
    readonly wallClock: WallClock;
};
