import { serializeValue } from '../compare/serialized-value.ts';
import type { TestPlan } from '../engine/test-plan.ts';
import { invalidRequest } from './run-errors.ts';
import { copyResourceBudgets, runEngineFacts } from './run-support.ts';
import type {
    RunCaseFacts,
    RunCommand,
    RunConfig,
    RunFacts,
    RunMicrotestProfileConfig,
    RunOrchestratorDependencies,
    RunRequest,
    RunResourceBudgets,
    RunResourceUsagePolicy
} from './run-types.ts';

export type RunFactsInput = {
    readonly cases: readonly RunCaseFacts[];
    readonly config: RunConfig;
    readonly dependencies: RunOrchestratorDependencies;
    readonly engine: RunCommand['engine'];
    readonly request: RunRequest;
};

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
    requestOverrides: RunResourceBudgets | null
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

function hasResourceBudgets(resourceBudgets: RunResourceBudgets): boolean {
    return resourceBudgets.activeResourceCount !== null ||
        resourceBudgets.javaScriptEngineHeapBytes !== null ||
        resourceBudgets.residentSetBytes !== null ||
        resourceBudgets.residentSetGrowthBytesPerSecond !== null;
}

function assertResourceBudgetOverridesAllowed(
    measureResourceUsage: boolean,
    requestOverrides: RunResourceBudgets | null
): void {
    if (!measureResourceUsage && requestOverrides !== null && hasResourceBudgets(requestOverrides)) {
        invalidRequest('Resource budget overrides require resource usage measurement.');
    }
}

export function selectedProfile(request: RunRequest, config: RunConfig): RunMicrotestProfileConfig {
    const profile = config.profiles[request.profile];

    if (profile === undefined) {
        invalidRequest(`Unknown run profile: ${request.profile}`);
    }

    return profile;
}

export function resolveResourceUsagePolicy(
    request: RunRequest,
    profile: RunMicrotestProfileConfig
): RunResourceUsagePolicy {
    const configuredPolicy = profile.resourceUsage;
    const measureResourceUsage = request.measureResourceUsage ?? configuredPolicy.measure;
    const resourceUsageSamplingIntervalMilliseconds = request.resourceUsageSamplingIntervalMilliseconds ??
        configuredPolicy.samplingIntervalMilliseconds;
    const resourceBudgets = measureResourceUsage
        ? resolveResourceBudgets(configuredPolicy.budgets, request.resourceBudgetOverrides)
        : disabledResourceBudgets();

    assertResourceBudgetOverridesAllowed(measureResourceUsage, request.resourceBudgetOverrides);

    return {
        budgets: resourceBudgets,
        measure: measureResourceUsage,
        samplingIntervalMilliseconds: resourceUsageSamplingIntervalMilliseconds
    };
}

function resolvedSeed(request: RunRequest, dependencies: RunOrchestratorDependencies): bigint {
    return request.seed.value ?? dependencies.createSeed();
}

function runCaseFacts(metadata: RunCaseFacts['metadata'], id: RunCaseFacts['id']): RunCaseFacts {
    return { id, metadata };
}

export function runCaseFactsFromTestPlan(testPlan: TestPlan): readonly RunCaseFacts[] {
    return testPlan.cases.map(function toRunCaseFacts(testCase) {
        return runCaseFacts(serializeValue(testCase.metadata), testCase.id);
    });
}

export function createRunFacts(input: RunFactsInput): RunFacts {
    const profile = selectedProfile(input.request, input.config);

    return {
        cases: input.cases,
        environment: {
            node: {
                arch: input.dependencies.node.arch,
                platform: input.dependencies.node.platform,
                version: input.dependencies.node.version
            },
            runtimeStateDir: input.config.runtimeStateDir
        },
        execution: {
            baselineUpdateMode: input.request.baselineUpdateMode,
            capture: input.request.capture,
            debug: input.request.debug,
            engine: runEngineFacts(input.engine),
            order: input.request.order,
            processModel: profile.execution.processModel,
            profile: input.request.profile,
            resourceUsagePolicy: resolveResourceUsagePolicy(input.request, profile),
            scheduling: profile.execution.scheduling,
            testFamily: profile.testFamily,
            timeoutPolicy: profile.timeouts,
            verbose: input.request.verbose
        },
        loader: input.config.loader,
        reproducibility: {
            seed: resolvedSeed(input.request, input.dependencies).toString(),
            shard: input.request.shard
        }
    };
}
