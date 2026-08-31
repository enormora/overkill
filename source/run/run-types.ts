import type { WallClock } from '@enormora/wall-clock';
import type { NonEmptyReadonlyArray } from '../assertion-protocol/assertion-node-shape.ts';
import type { SerializedValue as SerializedValueShape } from '../compare/serialized-value.ts';
import type { Execute } from '../engine/execution.ts';
import type { Engine } from '../engine/engine.ts';
import type { ReporterDispatcher } from '../engine/reporter-dispatcher.ts';
import type { OrphanedNode, RunResourceUsageTracker, RunResult } from '../engine/run-result.ts';
import type { TestPlan } from '../engine/test-plan.ts';
import type { RuntimeCapabilityPolicyDependencies } from './capability-policy.ts';
import type { ResourceUsageTrackerOptions } from './resource-usage.ts';

export type SerializedValue = SerializedValueShape;
type RunExecuteOptions = NonNullable<Parameters<Execute>[1]>;
type RunCaseId = TestPlan['discoveredCases'][number]['id'];
type RunOutputRenderer = NonNullable<RunExecuteOptions['outputRenderer']>;
type RunReporters = RunExecuteOptions['reporters'];

export type RunStringFilterField = keyof {
    readonly file: true;
    readonly name: true;
    readonly owner: true;
    readonly params: true;
    readonly runtime: true;
    readonly stability: true;
    readonly suite: true;
    readonly tag: true;
};

type RunAllFilter = {
    readonly filters: NonEmptyReadonlyArray<RunFilter>;
    readonly kind: 'all';
};

type RunAnyFilter = {
    readonly filters: NonEmptyReadonlyArray<RunFilter>;
    readonly kind: 'any';
};

type RunCaseIdFilter = {
    readonly id: RunCaseId;
    readonly kind: 'case-id';
};

type RunContainsFilter = {
    readonly field: RunStringFilterField;
    readonly kind: 'contains';
    readonly value: string;
};

type RunEqualsFilter = {
    readonly field: RunStringFilterField;
    readonly kind: 'equals';
    readonly value: string;
};

type RunGlobFilter = {
    readonly field: RunStringFilterField;
    readonly kind: 'glob';
    readonly pattern: string;
};

type RunNotFilter = {
    readonly filter: RunFilter;
    readonly kind: 'not';
};

type RunFilterByKind = {
    readonly all: RunAllFilter;
    readonly any: RunAnyFilter;
    readonly 'case-id': RunCaseIdFilter;
    readonly contains: RunContainsFilter;
    readonly equals: RunEqualsFilter;
    readonly glob: RunGlobFilter;
    readonly not: RunNotFilter;
};

export type RunFilter = RunFilterByKind[keyof RunFilterByKind];

type RunAllSelection = {
    readonly kind: 'all';
};

type RunFilterSelection = {
    readonly filter: RunFilter;
    readonly kind: 'filter';
};

export type RunSelection = RunAllSelection | RunFilterSelection;

export type RunEngineSelection = {
    readonly engine: Engine;
    readonly kind: 'instance';
} | {
    readonly exportKind: 'getter' | 'value';
    readonly exportName: string;
    readonly kind: 'module';
    readonly moduleUrl: string;
} | {
    readonly kind: 'default';
};

export type RunShard = {
    readonly index: number;
    readonly total: number;
};

export type RunExecutionRequest = {
    readonly mode: 'profile-default';
};

type RunCapabilityRestrictionsRequest = {
    readonly mode: 'disabled' | 'enabled';
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
    readonly collectionMilliseconds: number;
    readonly hardMilliseconds: number;
    readonly softMilliseconds: number;
};

export type RunProfileFiles = {
    readonly exclude: readonly string[];
    readonly include: NonEmptyReadonlyArray<string>;
};

export type RunMicrotestProfileConfig = {
    readonly execution: RunMicrotestExecution;
    readonly files: RunProfileFiles | null;
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
    readonly capabilityRestrictions: RunCapabilityRestrictionsRequest;
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
    readonly engine: RunEngineSelection;
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
    readonly engine: RunEngineFacts;
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
    readonly selection: RunSelection;
    readonly seed: string;
    readonly shard: RunShard;
};

export type RunEngineFacts = {
    readonly exportKind: 'getter' | 'value';
    readonly exportName: string;
    readonly kind: 'module';
    readonly moduleUrl: string;
} | {
    readonly kind: 'default';
} | {
    readonly kind: 'instance';
};

export type CollectedRunCase = {
    readonly definitionLocation: TestPlan['cases'][number]['definitionLocation'];
    readonly metadata: TestPlan['cases'][number]['metadata'];
    readonly name: string;
    readonly params: string | null;
    readonly suite: readonly string[];
    readonly suiteDefinitionLocations: TestPlan['cases'][number]['suiteDefinitionLocations'];
};

export type CollectedRunFile = {
    readonly cases: readonly CollectedRunCase[];
    readonly file: string;
};

export type CollectedRunPlan = {
    readonly defined: number;
    readonly discoveredFiles: readonly CollectedRunFile[];
    readonly files: readonly CollectedRunFile[];
    readonly orphans: readonly OrphanedNode[];
    readonly root: {
        readonly metadata: TestPlan['root']['metadata'];
        readonly name: string;
    };
};

export type ResolvedRunPlan = {
    readonly collectedPlan: CollectedRunPlan;
    readonly kind: 'supervised';
} | {
    readonly kind: 'local';
    readonly testPlan: TestPlan;
};

export type ResolvedRun = {
    readonly collectionRunnerErrors: readonly RunResult['runnerErrors'][number][];
    readonly config: RunConfig;
    readonly cwd: string;
    readonly engine: RunEngineSelection;
    readonly facts: RunFacts;
    readonly plan: ResolvedRunPlan;
    readonly reporters: RunReporters;
    readonly request: RunRequest;
};

export type RunOrchestratorDependencies = {
    readonly createSeed: () => bigint;
    readonly createResourceUsageTracker: (options: ResourceUsageTrackerOptions) => RunResourceUsageTracker;
    readonly defaultEngine: Engine;
    readonly execute: Execute;
    readonly runtimeCapabilityPolicy: RuntimeCapabilityPolicyDependencies;
    readonly node: {
        readonly arch: string;
        readonly platform: string;
        readonly version: string;
    };
    readonly reporterDispatcher: ReporterDispatcher;
    readonly wallClock: WallClock;
};

export type RunOrchestrator = {
    readonly resolve: (command: RunCommand) => Promise<ResolvedRun>;
    readonly run: (command: RunCommand) => Promise<RunResult>;
    readonly runWithReporterDelivery: (command: RunCommand) => Promise<{
        readonly deliveredRunnerErrors: readonly RunResult['runnerErrors'][number][];
        readonly result: RunResult;
    }>;
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
