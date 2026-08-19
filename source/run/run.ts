import { randomBytes } from 'node:crypto';
import { createWallClock } from '@enormora/wall-clock';
import { serializeValue, type SerializedValue as SerializedValueShape } from '../compare/serialized-value.ts';
import { createExecute, type Execute } from '../engine/execution.ts';
import type { CaseId } from '../engine/identity.ts';
import { createReporterDispatcher } from '../engine/reporter-dispatcher.ts';
import type { RunResourceUsageTracker, RunResult } from '../engine/run-result.ts';
import type { Metadata } from '../engine/test-node.ts';
import type { TestPlan } from '../engine/test-plan.ts';
import { createNodeResourceUsageTracker, type ResourceUsageTrackerOptions } from './resource-usage.ts';

const minimumSeedValue = 0n;
const seedByteLength = 8;

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
    readonly mode: 'concurrent-in-process';
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
    readonly stripMode: 'strip-only' | 'transform';
};

export type RunResourceBudgets = {
    readonly activeResourceCount: number | null;
    readonly javaScriptEngineHeapBytes: number | null;
    readonly residentSetBytes: number | null;
    readonly residentSetGrowthBytesPerSecond: number | null;
};

export type ResourceBudgetOverrides = {
    readonly activeResourceCount: number | null;
    readonly javaScriptEngineHeapBytes: number | null;
    readonly residentSetBytes: number | null;
    readonly residentSetGrowthBytesPerSecond: number | null;
};

export type RunResourceUsagePolicy = {
    readonly measureResourceUsage: boolean;
    readonly resourceBudgets: RunResourceBudgets;
    readonly resourceUsageSamplingIntervalMilliseconds: number;
};

export type RunProfilesConfig = {
    readonly microtest: RunResourceUsagePolicy;
};

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
    readonly coverage: false;
    readonly debug: RunDebugRequest;
    readonly execution: RunExecutionRequest;
    readonly measureResourceUsage: boolean | null;
    readonly order: 'plan';
    readonly paths: readonly string[];
    readonly profile: 'microtest';
    readonly resourceBudgetOverrides: ResourceBudgetOverrides | null;
    readonly resourceUsageSamplingIntervalMilliseconds: number | null;
    readonly seed: RunSeed;
    readonly selection: RunSelection;
    readonly shard: RunShard;
    readonly verbose: false;
};

export type RunCommand = {
    readonly config: RunConfig;
    readonly request: RunRequest;
    readonly testPlan: TestPlan;
};

export type RunFacts = {
    readonly cases: readonly RunCaseFacts[];
    readonly environment: RunEnvironmentFacts;
    readonly execution: RunExecutionFacts;
    readonly loader: RunLoaderConfig;
    readonly reproducibility: RunReproducibilityFacts;
};

export type RunCaseFacts = {
    readonly id: CaseId;
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
    readonly coverage: false;
    readonly debug: RunDebugRequest;
    readonly mode: 'concurrent-in-process';
    readonly order: 'plan';
    readonly profile: 'microtest';
    readonly resourceUsagePolicy: RunResourceUsagePolicy;
    readonly verbose: false;
};

export type RunReproducibilityFacts = {
    readonly seed: string;
    readonly shard: RunShard;
};

export type ResolvedRun = {
    readonly config: RunConfig;
    readonly facts: RunFacts;
    readonly reporters: RunReporters;
    readonly request: RunRequest;
    readonly testPlan: TestPlan;
};

export type RunResolutionErrorCode = 'invalid-request' | 'unsupported-request';

export class RunResolutionError extends Error {
    private readonly errorCode: RunResolutionErrorCode;

    public constructor(message: string, options: Readonly<ErrorOptions> | undefined, code: RunResolutionErrorCode) {
        super(message, options);
        this.name = 'RunResolutionError';
        this.errorCode = code;
    }

    public code(): RunResolutionErrorCode {
        return this.errorCode;
    }
}

export type RunOrchestratorDependencies = {
    readonly createSeed: () => bigint;
    readonly createResourceUsageTracker: (options: ResourceUsageTrackerOptions) => RunResourceUsageTracker;
    readonly execute: Execute;
    readonly node: {
        readonly arch: string;
        readonly platform: string;
        readonly version: string;
    };
    readonly readStartedAt: () => string;
};

export type RunOrchestrator = {
    readonly resolve: (command: RunCommand) => Promise<ResolvedRun>;
    readonly run: (command: RunCommand) => Promise<RunResult>;
};

function unsupportedRequest(message: string): never {
    throw new RunResolutionError(message, undefined, 'unsupported-request');
}

function invalidRequest(message: string): never {
    throw new RunResolutionError(message, undefined, 'invalid-request');
}

function validateRunPaths(request: RunRequest): void {
    if (request.paths.length > 0) {
        unsupportedRequest('Path discovery is not implemented yet.');
    }
}

function validateRunShard(request: RunRequest): void {
    if (request.shard.index !== 0 || request.shard.total !== 1) {
        unsupportedRequest('Sharding is not implemented yet.');
    }
}

function validateRunSeed(request: RunRequest): void {
    if (request.seed.value !== null && request.seed.value < minimumSeedValue) {
        invalidRequest('Run seed must be a nonnegative bigint.');
    }
}

function validatePositiveSafeInteger(value: number | null, label: string): void {
    if (value !== null && (!Number.isSafeInteger(value) || value <= 0)) {
        invalidRequest(`${label} must be a positive safe integer.`);
    }
}

function validateResourceBudgets(resourceBudgets: RunResourceBudgets): void {
    validatePositiveSafeInteger(resourceBudgets.activeResourceCount, 'Active resource count budget');
    validatePositiveSafeInteger(resourceBudgets.javaScriptEngineHeapBytes, 'JavaScript engine heap budget');
    validatePositiveSafeInteger(resourceBudgets.residentSetBytes, 'Resident set budget');
    validatePositiveSafeInteger(resourceBudgets.residentSetGrowthBytesPerSecond, 'Resident set growth budget');
}

function validateSamplingInterval(value: number | null): void {
    validatePositiveSafeInteger(value, 'Resource usage sampling interval');
}

function hasResourceBudgets(resourceBudgets: RunResourceBudgets): boolean {
    return resourceBudgets.activeResourceCount !== null ||
        resourceBudgets.javaScriptEngineHeapBytes !== null ||
        resourceBudgets.residentSetBytes !== null ||
        resourceBudgets.residentSetGrowthBytesPerSecond !== null;
}

function validateRunResourceUsageRequest(request: RunRequest): void {
    if (request.resourceBudgetOverrides !== null) {
        validateResourceBudgets(request.resourceBudgetOverrides);
    }

    validateSamplingInterval(request.resourceUsageSamplingIntervalMilliseconds);

    if (
        request.measureResourceUsage === false &&
        request.resourceBudgetOverrides !== null &&
        hasResourceBudgets(request.resourceBudgetOverrides)
    ) {
        invalidRequest('Resource budget overrides require resource usage measurement.');
    }
}

function validateRunRequest(request: RunRequest): void {
    validateRunPaths(request);
    validateRunShard(request);
    validateRunSeed(request);
    validateRunResourceUsageRequest(request);
}

function validateRunResourceUsagePolicy(policy: RunResourceUsagePolicy): void {
    validateResourceBudgets(policy.resourceBudgets);
    validateSamplingInterval(policy.resourceUsageSamplingIntervalMilliseconds);

    if (!policy.measureResourceUsage && hasResourceBudgets(policy.resourceBudgets)) {
        invalidRequest('Resource budgets require resource usage measurement.');
    }
}

function validateRunConfig(config: RunConfig): void {
    validateRunResourceUsagePolicy(config.profiles.microtest);
}

function resolvedSeed(request: RunRequest, dependencies: RunOrchestratorDependencies): bigint {
    return request.seed.value ?? dependencies.createSeed();
}

function copyLoaderConfig(loader: RunLoaderConfig): RunLoaderConfig {
    return {
        sourceMaps: loader.sourceMaps,
        stripMode: loader.stripMode
    };
}

function copyRunShard(shard: RunShard): RunShard {
    return {
        index: shard.index,
        total: shard.total
    };
}

function copyResourceBudgets(resourceBudgets: RunResourceBudgets): RunResourceBudgets {
    return {
        activeResourceCount: resourceBudgets.activeResourceCount,
        javaScriptEngineHeapBytes: resourceBudgets.javaScriptEngineHeapBytes,
        residentSetBytes: resourceBudgets.residentSetBytes,
        residentSetGrowthBytesPerSecond: resourceBudgets.residentSetGrowthBytesPerSecond
    };
}

function copyResourceBudgetOverrides(overrides: ResourceBudgetOverrides | null): ResourceBudgetOverrides | null {
    if (overrides === null) {
        return null;
    }

    return copyResourceBudgets(overrides);
}

function copyResourceUsagePolicy(policy: RunResourceUsagePolicy): RunResourceUsagePolicy {
    return {
        measureResourceUsage: policy.measureResourceUsage,
        resourceBudgets: copyResourceBudgets(policy.resourceBudgets),
        resourceUsageSamplingIntervalMilliseconds: policy.resourceUsageSamplingIntervalMilliseconds
    };
}

function copyRunProfilesConfig(profiles: RunProfilesConfig): RunProfilesConfig {
    return {
        microtest: copyResourceUsagePolicy(profiles.microtest)
    };
}

function copyRunRequest(request: RunRequest): RunRequest {
    return {
        baselineUpdateMode: request.baselineUpdateMode,
        capture: request.capture,
        coverage: request.coverage,
        debug: {
            mode: request.debug.mode,
            selectors: []
        },
        execution: { mode: request.execution.mode },
        measureResourceUsage: request.measureResourceUsage,
        order: request.order,
        paths: Array.from(request.paths),
        profile: request.profile,
        resourceBudgetOverrides: copyResourceBudgetOverrides(request.resourceBudgetOverrides),
        resourceUsageSamplingIntervalMilliseconds: request.resourceUsageSamplingIntervalMilliseconds,
        seed: { value: request.seed.value },
        selection: { kind: request.selection.kind },
        shard: copyRunShard(request.shard),
        verbose: request.verbose
    };
}

function copyRunConfig(config: RunConfig): RunConfig {
    return {
        loader: copyLoaderConfig(config.loader),
        outputRenderer: config.outputRenderer,
        profiles: copyRunProfilesConfig(config.profiles),
        reporters: Array.from(config.reporters),
        runtimeStateDir: config.runtimeStateDir
    };
}

function runCaseFacts(metadata: Metadata, id: CaseId): RunCaseFacts {
    return {
        id,
        metadata: serializeValue(metadata)
    };
}

function disabledResourceBudgets(): RunResourceBudgets {
    return {
        activeResourceCount: null,
        javaScriptEngineHeapBytes: null,
        residentSetBytes: null,
        residentSetGrowthBytesPerSecond: null
    };
}

function readBudgetOverride(configValue: number | null, requestValue: number | null): number | null {
    return requestValue ?? configValue;
}

function resolveResourceBudgets(
    configBudgets: RunResourceBudgets,
    requestOverrides: ResourceBudgetOverrides | null
): RunResourceBudgets {
    if (requestOverrides === null) {
        return copyResourceBudgets(configBudgets);
    }

    return {
        activeResourceCount: readBudgetOverride(
            configBudgets.activeResourceCount,
            requestOverrides.activeResourceCount
        ),
        javaScriptEngineHeapBytes: readBudgetOverride(
            configBudgets.javaScriptEngineHeapBytes,
            requestOverrides.javaScriptEngineHeapBytes
        ),
        residentSetBytes: readBudgetOverride(configBudgets.residentSetBytes, requestOverrides.residentSetBytes),
        residentSetGrowthBytesPerSecond: readBudgetOverride(
            configBudgets.residentSetGrowthBytesPerSecond,
            requestOverrides.residentSetGrowthBytesPerSecond
        )
    };
}

function assertResourceBudgetOverridesAllowed(
    measureResourceUsage: boolean,
    requestOverrides: ResourceBudgetOverrides | null
): void {
    if (!measureResourceUsage && requestOverrides !== null && hasResourceBudgets(requestOverrides)) {
        invalidRequest('Resource budget overrides require resource usage measurement.');
    }
}

function resolveResourceUsagePolicy(request: RunRequest, config: RunConfig): RunResourceUsagePolicy {
    const configuredPolicy = config.profiles.microtest;
    const measureResourceUsage = request.measureResourceUsage ?? configuredPolicy.measureResourceUsage;
    const resourceUsageSamplingIntervalMilliseconds = request.resourceUsageSamplingIntervalMilliseconds ??
        configuredPolicy.resourceUsageSamplingIntervalMilliseconds;
    const resourceBudgets = measureResourceUsage
        ? resolveResourceBudgets(configuredPolicy.resourceBudgets, request.resourceBudgetOverrides)
        : disabledResourceBudgets();

    assertResourceBudgetOverridesAllowed(measureResourceUsage, request.resourceBudgetOverrides);

    return {
        measureResourceUsage,
        resourceBudgets,
        resourceUsageSamplingIntervalMilliseconds
    };
}

function createRunFacts(
    command: RunCommand,
    request: RunRequest,
    config: RunConfig,
    dependencies: RunOrchestratorDependencies
): RunFacts {
    return {
        cases: command.testPlan.cases.map(function toRunCaseFacts(testCase) {
            return runCaseFacts(testCase.metadata, testCase.id);
        }),
        environment: {
            node: {
                arch: dependencies.node.arch,
                platform: dependencies.node.platform,
                version: dependencies.node.version
            },
            runtimeStateDir: config.runtimeStateDir
        },
        execution: {
            baselineUpdateMode: request.baselineUpdateMode,
            capture: request.capture,
            coverage: request.coverage,
            debug: request.debug,
            mode: request.execution.mode,
            order: request.order,
            profile: request.profile,
            resourceUsagePolicy: resolveResourceUsagePolicy(request, config),
            verbose: request.verbose
        },
        loader: config.loader,
        reproducibility: {
            seed: resolvedSeed(request, dependencies).toString(),
            shard: request.shard
        }
    };
}

function freezeValue<Value>(value: Value): Value {
    if (value !== null && typeof value === 'object') {
        for (const propertyValue of Object.values(value)) {
            freezeValue(propertyValue);
        }

        Object.freeze(value);
    }

    return value;
}

function createResolvedRun(command: RunCommand, dependencies: RunOrchestratorDependencies): ResolvedRun {
    validateRunRequest(command.request);
    validateRunConfig(command.config);

    const request = freezeValue(copyRunRequest(command.request));
    const config = freezeValue(copyRunConfig(command.config));
    const facts = freezeValue(createRunFacts(command, request, config, dependencies));

    return freezeValue({
        config,
        facts,
        reporters: config.reporters,
        request,
        testPlan: command.testPlan
    });
}

function assertRunnableResourceUsagePolicy(policy: RunResourceUsagePolicy): void {
    if (hasResourceBudgets(policy.resourceBudgets)) {
        unsupportedRequest('Resource budget enforcement is not implemented yet.');
    }
}

function createExecutionResourceUsageTracker(
    policy: RunResourceUsagePolicy,
    dependencies: RunOrchestratorDependencies
): RunResourceUsageTracker | null {
    if (!policy.measureResourceUsage) {
        return null;
    }

    return dependencies.createResourceUsageTracker({
        samplingIntervalMilliseconds: policy.resourceUsageSamplingIntervalMilliseconds
    });
}

export function createRunOrchestrator(dependencies: RunOrchestratorDependencies): RunOrchestrator {
    return {
        async resolve(command) {
            return createResolvedRun(command, dependencies);
        },

        async run(command) {
            const resolvedRun = createResolvedRun(command, dependencies);
            const { resourceUsagePolicy } = resolvedRun.facts.execution;

            assertRunnableResourceUsagePolicy(resourceUsagePolicy);

            return await dependencies.execute(resolvedRun.testPlan, {
                execution: { mode: 'concurrent-in-process' },
                outputRenderer: resolvedRun.config.outputRenderer,
                reporters: resolvedRun.reporters,
                resourceUsageTracker: createExecutionResourceUsageTracker(resourceUsagePolicy, dependencies),
                runFacts: resolvedRun.facts,
                startedAt: dependencies.readStartedAt()
            });
        }
    };
}

function createDefaultSeed(): bigint {
    return randomBytes(seedByteLength).readBigUInt64BE();
}

const defaultWallClock = createWallClock();
function writeStdoutLine(line: string): void {
    process.stdout.write(`${line}\n`);
}

function writeStderrLine(line: string): void {
    process.stderr.write(`${line}\n`);
}

const defaultRunOrchestrator = createRunOrchestrator({
    createSeed: createDefaultSeed,
    createResourceUsageTracker(options) {
        return createNodeResourceUsageTracker(defaultWallClock, options);
    },
    execute: createExecute({
        reporterDispatcher: createReporterDispatcher({
            stderr: { writeLine: writeStderrLine },
            stdout: { writeLine: writeStdoutLine },
            wallClock: defaultWallClock
        }),
        wallClock: defaultWallClock
    }),
    node: {
        arch: process.arch,
        platform: process.platform,
        version: process.versions.node
    },
    readStartedAt() {
        const startedAt = new Date(defaultWallClock.currentTimestampInMilliseconds);

        return startedAt.toISOString();
    }
});

export const orchestrator: RunOrchestrator = defaultRunOrchestrator;
