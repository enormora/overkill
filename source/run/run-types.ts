import type { WallClock } from '@enormora/wall-clock';
import type { SerializedValue as SerializedValueShape } from '../compare/serialized-value.ts';
import type { Execute } from '../engine/execution.ts';
import type { Engine } from '../engine/engine.ts';
import type { ReporterDispatcher } from '../engine/reporter-dispatcher.ts';
import type { RunResourceUsageTracker, RunResult } from '../engine/run-result.ts';
import type { TestPlan } from '../engine/test-plan.ts';
import type { ResourceUsageTrackerOptions } from './resource-usage.ts';

export type SerializedValue = SerializedValueShape;
type RunExecuteOptions = NonNullable<Parameters<Execute>[1]>;
type RunOutputRenderer = NonNullable<RunExecuteOptions['outputRenderer']>;
type RunReporters = RunExecuteOptions['reporters'];

export type RunSelection = {
    readonly kind: 'all';
};

export type RunShard = {
    readonly index: number;
    readonly total: number;
};

export type RunExecutionRequest = {
    readonly mode: 'profile-default';
};

export type RunSeed = {
    readonly value: bigint | null;
};

export type RunDebugRequest = {
    readonly mode: 'off';
    readonly selectors: readonly [];
};

export type RunLoaderConfig = {
    readonly sourceMaps: boolean;
    readonly stripMode: 'strip-only';
};

export type RunResourceBudgets = {
    readonly activeResourceCount: number | null;
    readonly javaScriptEngineHeapBytes: number | null;
    readonly residentSetBytes: number | null;
    readonly residentSetGrowthBytesPerSecond: number | null;
};

const runProfileNamePattern = /^[A-Za-z0-9._-]+$/u;
const reservedBenchmarkProfileName = 'benchmark';

export type RunTestFamily = 'microtest';

export type RunProcessModel = 'in-process' | 'supervised-process';

export type RunScheduling = 'concurrent' | 'serial';

export type RunMicrotestExecution = {
    readonly processModel: RunProcessModel;
    readonly scheduling: RunScheduling;
};

export type RunResourceUsagePolicy = {
    readonly budgets: RunResourceBudgets;
    readonly measure: boolean;
    readonly samplingIntervalMilliseconds: number;
};

export type RunTimeoutPolicy = {
    readonly hardMilliseconds: number;
    readonly softMilliseconds: number;
};

export type RunMicrotestProfileConfig = {
    readonly execution: RunMicrotestExecution;
    readonly reporters: RunReporters | null;
    readonly resourceUsage: RunResourceUsagePolicy;
    readonly testFamily: 'microtest';
    readonly timeouts: RunTimeoutPolicy;
};

export type RunProfileConfig = Readonly<
    {
        [Property in keyof RunMicrotestProfileConfig]: RunMicrotestProfileConfig[Property];
    }
>;

export type RunProfilesConfig = Readonly<Record<string, RunProfileConfig>>;

export type RunConfig = {
    readonly loader: RunLoaderConfig;
    readonly outputRenderer: RunOutputRenderer;
    readonly profiles: RunProfilesConfig;
    readonly reporters: RunReporters;
    readonly runtimeStateDir: string;
};

export type RunRequest = {
    readonly baselineUpdateMode: 'none';
    readonly capture: 'buffered' | 'live';
    readonly debug: RunDebugRequest;
    readonly execution: RunExecutionRequest;
    readonly measureResourceUsage: boolean | null;
    readonly order: 'plan';
    readonly paths: readonly string[];
    readonly profile: string;
    readonly resourceBudgetOverrides: RunResourceBudgets | null;
    readonly resourceUsageSamplingIntervalMilliseconds: number | null;
    readonly seed: RunSeed;
    readonly selection: RunSelection;
    readonly shard: RunShard;
    readonly verbose: false;
};

export type RunCommand = {
    readonly config: RunConfig;
    readonly cwd: string;
    readonly engine: Engine | null;
    readonly request: RunRequest;
};

export type RunFacts = {
    readonly cases: readonly RunCaseFacts[];
    readonly environment: RunEnvironmentFacts;
    readonly execution: RunExecutionFacts;
    readonly loader: RunLoaderConfig;
    readonly reproducibility: RunReproducibilityFacts;
};

export type RunCaseFacts = {
    readonly id: TestPlan['cases'][number]['id'];
    readonly metadata: SerializedValue;
};

export type RunEnvironmentFacts = {
    readonly node: {
        readonly arch: string;
        readonly platform: string;
        readonly version: string;
    };
    readonly runtimeStateDir: string;
};

export type RunExecutionFacts = {
    readonly baselineUpdateMode: 'none';
    readonly capture: 'buffered' | 'live';
    readonly debug: RunDebugRequest;
    readonly order: 'plan';
    readonly processModel: RunProcessModel;
    readonly profile: string;
    readonly resourceUsagePolicy: RunResourceUsagePolicy;
    readonly scheduling: RunScheduling;
    readonly testFamily: RunTestFamily;
    readonly timeoutPolicy: RunTimeoutPolicy;
    readonly verbose: false;
};

export type RunReproducibilityFacts = {
    readonly seed: string;
    readonly shard: RunShard;
};

export type ResolvedRun = {
    readonly config: RunConfig;
    readonly cwd: string;
    readonly facts: RunFacts;
    readonly reporters: RunReporters;
    readonly request: RunRequest;
    readonly testPlan: TestPlan;
};

export type RunOrchestratorDependencies = {
    readonly createSeed: () => bigint;
    readonly createResourceUsageTracker: (options: ResourceUsageTrackerOptions) => RunResourceUsageTracker;
    readonly defaultEngine: Engine;
    readonly execute: Execute;
    readonly node: {
        readonly arch: string;
        readonly platform: string;
        readonly version: string;
    };
    readonly reporterDispatcher: ReporterDispatcher;
    readonly readStartedAt: () => string;
    readonly wallClock: WallClock;
};

export type RunOrchestrator = {
    readonly resolve: (command: RunCommand) => Promise<ResolvedRun>;
    readonly run: (command: RunCommand) => Promise<RunResult>;
};

export function invalidRunProfileNameMessage(profileName: string): string | null {
    if (!runProfileNamePattern.test(profileName)) {
        return `Invalid profile name "${profileName}". ` +
            'Profile names may only contain letters, numbers, dots, underscores, and hyphens.';
    }

    if (profileName === reservedBenchmarkProfileName) {
        return 'Invalid profile name "benchmark". The "benchmark" profile name is reserved for benchmark commands.';
    }

    return null;
}
