import {
    createRuntimeCapabilityPolicy,
    type RuntimeCapabilityPolicy
} from './capability-policy.ts';
import type {
    RunConfig,
    RunEngineFacts,
    RunEngineSelection,
    RunLoaderConfig,
    RunMicrotestExecution,
    RunMicrotestProfileConfig,
    RunOrchestratorDependencies,
    RunProfilesConfig,
    RunRequest,
    RunResourceBudgets,
    RunResourceUsagePolicy,
    RunShard,
    RunTimeoutPolicy
} from './run-types.ts';

export type RunRuntimePolicy = RuntimeCapabilityPolicy;

export function resolveRunReporters(
    profile: RunMicrotestProfileConfig,
    fallbackReporters: RunConfig['reporters']
): RunConfig['reporters'] {
    return profile.reporters ?? fallbackReporters;
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

export function copyResourceBudgets(resourceBudgets: RunResourceBudgets): RunResourceBudgets {
    return {
        activeResourceCount: resourceBudgets.activeResourceCount,
        javaScriptEngineHeapBytes: resourceBudgets.javaScriptEngineHeapBytes,
        residentSetBytes: resourceBudgets.residentSetBytes,
        residentSetGrowthBytesPerSecond: resourceBudgets.residentSetGrowthBytesPerSecond
    };
}

function copyResourceBudgetOverrides(overrides: RunResourceBudgets | null): RunResourceBudgets | null {
    if (overrides === null) {
        return null;
    }

    return copyResourceBudgets(overrides);
}

function copyResourceUsagePolicy(policy: RunResourceUsagePolicy): RunResourceUsagePolicy {
    return {
        budgets: copyResourceBudgets(policy.budgets),
        measure: policy.measure,
        samplingIntervalMilliseconds: policy.samplingIntervalMilliseconds
    };
}

function copyTimeoutPolicy(policy: RunTimeoutPolicy): RunTimeoutPolicy {
    return {
        collectionMilliseconds: policy.collectionMilliseconds,
        hardMilliseconds: policy.hardMilliseconds,
        softMilliseconds: policy.softMilliseconds
    };
}

function copyExecution(execution: RunMicrotestExecution): RunMicrotestExecution {
    return {
        processModel: execution.processModel,
        scheduling: execution.scheduling
    };
}

function copyProfileConfig(profile: RunMicrotestProfileConfig): RunMicrotestProfileConfig {
    return {
        execution: copyExecution(profile.execution),
        reporters: profile.reporters === null ? null : Array.from(profile.reporters),
        resourceUsage: copyResourceUsagePolicy(profile.resourceUsage),
        testFamily: profile.testFamily,
        timeouts: copyTimeoutPolicy(profile.timeouts)
    };
}

function copyRunProfilesConfig(profiles: RunProfilesConfig): RunProfilesConfig {
    return Object.fromEntries(
        Object.entries(profiles).map(function copyProfileEntry([ name, profile ]) {
            return [ name, copyProfileConfig(profile) ];
        })
    );
}

export function copyRunRequest(request: RunRequest): RunRequest {
    return {
        baselineUpdateMode: request.baselineUpdateMode,
        capabilityRestrictions: { mode: request.capabilityRestrictions.mode },
        capture: request.capture,
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

export function copyRunConfig(config: RunConfig): RunConfig {
    return {
        loader: copyLoaderConfig(config.loader),
        outputRenderer: config.outputRenderer,
        profiles: copyRunProfilesConfig(config.profiles),
        reporters: Array.from(config.reporters),
        runtimeStateDir: config.runtimeStateDir
    };
}

export function copyRunEngineSelection(engine: RunEngineSelection): RunEngineSelection {
    if (engine.kind === 'instance') {
        return {
            engine: engine.engine,
            kind: 'instance'
        };
    }

    if (engine.kind === 'module') {
        return {
            exportKind: engine.exportKind,
            exportName: engine.exportName,
            kind: 'module',
            moduleUrl: engine.moduleUrl
        };
    }

    return { kind: 'default' };
}

export function runEngineFacts(engine: RunEngineSelection): RunEngineFacts {
    if (engine.kind === 'instance') {
        return { kind: 'instance' };
    }

    if (engine.kind === 'module') {
        return {
            exportKind: engine.exportKind,
            exportName: engine.exportName,
            kind: 'module',
            moduleUrl: engine.moduleUrl
        };
    }

    return { kind: 'default' };
}

export function createRunRuntimePolicy(
    request: RunRequest,
    dependencies: RunOrchestratorDependencies
): RunRuntimePolicy | null {
    return request.capabilityRestrictions.mode === 'enabled'
        ? createRuntimeCapabilityPolicy({
            dependencies: dependencies.runtimeCapabilityPolicy,
            observedStderr: false,
            observedStdout: false
        })
        : null;
}
