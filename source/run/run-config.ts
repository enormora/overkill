import path from 'node:path';
import { parse } from '@schema-hub/zod-error-formatter';
import type { NonEmptyReadonlyArray } from '../assertion-protocol/assertion-node-shape.ts';
import { createPlainOutputRenderer, type DefinedOutputRenderer } from '../engine/reporter-output.ts';
import type { DefinedReporter } from '../engine/reporter.ts';
import {
    projectConfigSchema,
    workerPoolProjectExecution,
    type RunProjectConfig as ParsedRunProjectConfig,
    type RunProjectCoverageOutput as ParsedRunProjectCoverageOutput,
    type RunProjectCoveragePolicy as ParsedRunProjectCoveragePolicy,
    type RunProjectCoverageSources as ParsedRunProjectCoverageSources,
    type RunProjectCoverageThresholds as ParsedRunProjectCoverageThresholds,
    type RunProjectIntegrationExecution as ParsedRunProjectIntegrationExecution,
    type RunProjectIntegrationProfileConfig as ParsedRunProjectIntegrationProfileConfig,
    type RunProjectMeasuredResourceUsage as ParsedRunProjectMeasuredResourceUsage,
    type RunProjectMicrotestExecution as ParsedRunProjectMicrotestExecution,
    type RunProjectMicrotestProfileConfig as ParsedRunProjectMicrotestProfileConfig,
    type RunProjectProfileFiles as ParsedRunProjectProfileFiles,
    type RunProjectResourceBudgets as ParsedRunProjectResourceBudgets,
    type RunProjectResourceUsageConfig as ParsedRunProjectResourceUsageConfig,
    type RunProjectTimingProfilePolicy as ParsedRunProjectTimingProfilePolicy,
    type RunProjectTimeoutConfig as ParsedRunProjectTimeoutConfig,
    type RunProjectUnmeasuredResourceUsage as ParsedRunProjectUnmeasuredResourceUsage
} from './run-config-schema.ts';
import type {
    RunIntegrationExecution,
    RunIntegrationProfileConfig,
    RunLoaderConfig,
    RunMicrotestProfileConfig,
    RunProfileConfig,
    RunProfilesConfig,
    RunResourceBudgets,
    RunResourceUsagePolicy,
    TimingProfilePolicy,
    RunTimeoutPolicy,
    RunWorkerPoolAssignmentPolicy,
    RunWorkerPoolHedgingPolicy,
    RunWorkerLifecycle
} from './run-types.ts';
import {
    assertValidProfileName,
    assertValidWorkDistribution,
    normalizeCoveragePolicy,
    normalizeProfileFiles,
    normalizeRequiredProfileFiles,
    normalizedWorkDistribution
} from './profile-config-normalization.ts';
import { RunConfigError } from './run-errors.ts';
import {
    defaultConfigFileNames,
    defaultIntegrationProcessModel,
    defaultIntegrationScheduling,
    defaultIntegrationTimeoutPolicy,
    defaultLoader,
    normalizeMicrotestExecution,
    normalizedMaxConcurrency,
    defaultResourceUsagePolicy,
    defaultResourceUsageSamplingIntervalMilliseconds,
    defaultTimingProfilePolicy,
    defaultTimeoutPolicy,
    defaultWorkerLifecycle,
    defaultWorkerPoolAssignmentPolicy,
    defaultWorkerPoolDispatchPolicy,
    defaultWorkerPoolHedgingPolicy
} from './run-config-defaults.ts';

type ProjectHostProcessGuard = Readonly<Partial<Record<'hostProcess', never>>>;
type ProjectRetryPolicyGuard = Readonly<Partial<Record<'retries', never>>>;

export type LoadedRunConfig = {
    readonly configPath: string | null;
    readonly loader: RunLoaderConfig;
    readonly outputRenderer: DefinedOutputRenderer;
    readonly profiles: RunProfilesConfig;
    readonly reporters: NonEmptyReadonlyArray<DefinedReporter> | null;
    readonly runtimeStateDir: string;
};

export type RunProjectIntegrationExecution = ParsedRunProjectIntegrationExecution & ProjectHostProcessGuard;
export type RunProjectIntegrationProfileConfig = Pick<ParsedRunProjectIntegrationProfileConfig, 'retries'> & {
    readonly coverage?: never;
    readonly execution?: RunProjectIntegrationExecution | undefined;
    readonly files: ParsedRunProjectIntegrationProfileConfig['files'];
    readonly reporters?: ParsedRunProjectIntegrationProfileConfig['reporters'];
    readonly resourceUsage?: ParsedRunProjectIntegrationProfileConfig['resourceUsage'];
    readonly testFamily: ParsedRunProjectIntegrationProfileConfig['testFamily'];
    readonly timings?: ParsedRunProjectIntegrationProfileConfig['timings'];
    readonly timeouts?: ParsedRunProjectIntegrationProfileConfig['timeouts'];
};
export type RunProjectMicrotestExecution = ParsedRunProjectMicrotestExecution;
export type RunProjectMicrotestProfileConfig = ParsedRunProjectMicrotestProfileConfig & ProjectRetryPolicyGuard;
export type RunProjectCoverageOutput = ParsedRunProjectCoverageOutput;
export type RunProjectCoveragePolicy = ParsedRunProjectCoveragePolicy;
export type RunProjectCoverageSources = ParsedRunProjectCoverageSources;
export type RunProjectCoverageThresholds = ParsedRunProjectCoverageThresholds;
export type RunProjectProfileFiles = ParsedRunProjectProfileFiles;
export type RunProjectProfileConfig = RunProjectIntegrationProfileConfig | RunProjectMicrotestProfileConfig;
export type RunProjectProfilesConfig = Readonly<Record<string, RunProjectProfileConfig>>;
export type RunProjectResourceBudgets = ParsedRunProjectResourceBudgets;
export type RunProjectMeasuredResourceUsage = ParsedRunProjectMeasuredResourceUsage;
export type RunProjectUnmeasuredResourceUsage = ParsedRunProjectUnmeasuredResourceUsage;
export type RunProjectResourceUsageConfig = ParsedRunProjectResourceUsageConfig;
export type RunProjectTimingProfilePolicy = ParsedRunProjectTimingProfilePolicy;
export type RunProjectTimeoutConfig = ParsedRunProjectTimeoutConfig;
export type RunProjectConfig = {
    readonly loader?: ParsedRunProjectConfig['loader'];
    readonly outputRenderer?: ParsedRunProjectConfig['outputRenderer'];
    readonly profiles?: RunProjectProfilesConfig | undefined;
    readonly reporters?: ParsedRunProjectConfig['reporters'];
    readonly runtimeStateDir?: ParsedRunProjectConfig['runtimeStateDir'];
};

export type RunConfigLoadRequest = {
    readonly configPath: string | null;
    readonly cwd: string;
};

export type RunConfigLoaderDependencies = {
    readonly fileExists: (filePath: string) => Promise<boolean>;
    readonly importModule: (configPath: string) => Promise<unknown>;
};

export type RunConfigLoader = (request: RunConfigLoadRequest) => Promise<LoadedRunConfig>;

export function defineConfig(config: RunProjectConfig): RunProjectConfig {
    return config;
}

async function discoverConfigPath(
    cwd: string,
    dependencies: RunConfigLoaderDependencies
): Promise<string | null> {
    for (const configFileName of defaultConfigFileNames) {
        const candidate = path.resolve(cwd, configFileName);

        if (await dependencies.fileExists(candidate)) {
            return candidate;
        }
    }

    return null;
}

async function resolveConfigPath(
    request: RunConfigLoadRequest,
    dependencies: RunConfigLoaderDependencies
): Promise<string | null> {
    if (request.configPath !== null) {
        return path.resolve(request.cwd, request.configPath);
    }

    return await discoverConfigPath(request.cwd, dependencies);
}

async function importConfigModule(
    configPath: string,
    dependencies: RunConfigLoaderDependencies
): Promise<unknown> {
    try {
        return await dependencies.importModule(configPath);
    } catch (error: unknown) {
        throw new RunConfigError(`Failed to load config file "${configPath}".`, { cause: error });
    }
}

type ConfigModuleWithDefaultExport = {
    readonly default: unknown;
};

type ConfigModuleWithNamedConfigExport = {
    readonly config: unknown;
};

function hasDefaultExport(configModule: unknown): configModule is ConfigModuleWithDefaultExport {
    return typeof configModule === 'object' && configModule !== null && Object.hasOwn(configModule, 'default');
}

function hasNamedConfigExport(configModule: unknown): configModule is ConfigModuleWithNamedConfigExport {
    return typeof configModule === 'object' && configModule !== null && Object.hasOwn(configModule, 'config');
}

function assertNoExtraConfigExports(configModule: ConfigModuleWithNamedConfigExport, configPath: string): void {
    const extraExports = Object.keys(configModule).filter(function isExtraExport(exportName) {
        return exportName !== 'config';
    });

    if (extraExports.length > 0) {
        throw new RunConfigError(`Config file "${configPath}" must only export a named config value.`);
    }
}

function readNamedConfigExport(configModule: unknown, configPath: string): unknown {
    if (hasDefaultExport(configModule)) {
        throw new RunConfigError(`Config file "${configPath}" must not export a default config.`);
    }

    if (hasNamedConfigExport(configModule)) {
        assertNoExtraConfigExports(configModule, configPath);

        return configModule.config;
    }

    throw new RunConfigError(`Config file "${configPath}" must export a named config value.`);
}

function normalizeReporters(
    reporters: NonEmptyReadonlyArray<DefinedReporter> | undefined
): LoadedRunConfig['reporters'] {
    return reporters ?? null;
}

function normalizeBudgetValue(value: number | null | undefined): number | null {
    return value ?? null;
}

function normalizeResourceBudgets(resourceBudgets: RunProjectResourceBudgets | undefined): RunResourceBudgets {
    return {
        activeResourceCount: normalizeBudgetValue(resourceBudgets?.activeResourceCount),
        javaScriptEngineHeapBytes: normalizeBudgetValue(resourceBudgets?.javaScriptEngineHeapBytes),
        residentSetBytes: normalizeBudgetValue(resourceBudgets?.residentSetBytes),
        residentSetGrowthBytesPerSecond: normalizeBudgetValue(resourceBudgets?.residentSetGrowthBytesPerSecond)
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

function copyResourceBudgets(resourceBudgets: RunResourceBudgets): RunResourceBudgets {
    return {
        activeResourceCount: resourceBudgets.activeResourceCount,
        javaScriptEngineHeapBytes: resourceBudgets.javaScriptEngineHeapBytes,
        residentSetBytes: resourceBudgets.residentSetBytes,
        residentSetGrowthBytesPerSecond: resourceBudgets.residentSetGrowthBytesPerSecond
    };
}

function copyResourceUsagePolicy(policy: RunResourceUsagePolicy): RunResourceUsagePolicy {
    return {
        budgets: copyResourceBudgets(policy.budgets),
        measure: policy.measure,
        samplingIntervalMilliseconds: policy.samplingIntervalMilliseconds
    };
}

function normalizeUnmeasuredResourceUsage(): RunResourceUsagePolicy {
    return {
        budgets: disabledResourceBudgets(),
        measure: false,
        samplingIntervalMilliseconds: defaultResourceUsageSamplingIntervalMilliseconds
    };
}

function normalizeMeasuredResourceUsage(profile: RunProjectMeasuredResourceUsage): RunResourceUsagePolicy {
    return {
        budgets: normalizeResourceBudgets(profile.budgets),
        measure: true,
        samplingIntervalMilliseconds: profile.samplingIntervalMilliseconds ??
            defaultResourceUsageSamplingIntervalMilliseconds
    };
}

function normalizeResourceUsage(
    profile: RunProjectResourceUsageConfig | undefined
): RunResourceUsagePolicy {
    if (profile === undefined) {
        return copyResourceUsagePolicy(defaultResourceUsagePolicy);
    }

    if (profile.measure !== true) {
        return normalizeUnmeasuredResourceUsage();
    }

    return normalizeMeasuredResourceUsage(profile);
}

function normalizeTimings(timings: RunProjectTimingProfilePolicy | undefined): TimingProfilePolicy {
    return timings ?? defaultTimingProfilePolicy;
}

function timeoutValue(value: number | undefined, fallback: number): number {
    return value ?? fallback;
}

function normalizeTimeouts(
    timeouts: RunProjectTimeoutConfig | undefined,
    defaultPolicy: RunTimeoutPolicy
): RunTimeoutPolicy {
    return {
        collectionMilliseconds: timeoutValue(timeouts?.collectionMilliseconds, defaultPolicy.collectionMilliseconds),
        hardMilliseconds: timeoutValue(timeouts?.hardMilliseconds, defaultPolicy.hardMilliseconds),
        softMilliseconds: timeoutValue(timeouts?.softMilliseconds, defaultPolicy.softMilliseconds)
    };
}

function assertValidTimeouts(timeouts: RunTimeoutPolicy): void {
    if (timeouts.softMilliseconds > timeouts.hardMilliseconds) {
        throw new RunConfigError(
            'Invalid profile timeouts: softMilliseconds must be less than or equal to hardMilliseconds.'
        );
    }
}

function normalizeWorkerLifecycle(execution: RunProjectIntegrationExecution | undefined): RunWorkerLifecycle {
    if (execution?.processModel !== 'worker-pool') {
        return defaultWorkerLifecycle;
    }

    return execution.workerLifecycle ?? defaultWorkerLifecycle;
}

function normalizeWorkerPoolAssignmentPolicy(
    execution: RunProjectIntegrationExecution | undefined
): RunWorkerPoolAssignmentPolicy {
    if (execution?.processModel !== 'worker-pool') {
        return defaultWorkerPoolAssignmentPolicy;
    }

    return execution.assignmentPolicy ?? defaultWorkerPoolAssignmentPolicy;
}

function normalizeWorkerPoolHedgingPolicy(
    execution: RunProjectIntegrationExecution | undefined
): RunWorkerPoolHedgingPolicy {
    if (execution?.processModel !== 'worker-pool') {
        return defaultWorkerPoolHedgingPolicy;
    }

    return execution.hedging ?? defaultWorkerPoolHedgingPolicy;
}

function assertValidWorkerPoolHedging(execution: RunIntegrationExecution): void {
    if (
        execution.processModel === 'worker-pool' &&
        execution.hedging.mode === 'on' &&
        execution.dispatchPolicy === 'static-assignment'
    ) {
        throw new RunConfigError('Invalid worker-pool hedging: hedging requires dynamic-lease dispatch.');
    }
}

function normalizeWorkerPoolExecution(
    execution: RunProjectIntegrationExecution | undefined,
    scheduling: RunIntegrationExecution['scheduling']
): RunIntegrationExecution {
    const workerPoolExecution = workerPoolProjectExecution(execution);

    return {
        assignmentPolicy: normalizeWorkerPoolAssignmentPolicy(execution),
        dispatchPolicy: workerPoolExecution?.dispatchPolicy ?? defaultWorkerPoolDispatchPolicy,
        hedging: normalizeWorkerPoolHedgingPolicy(execution),
        hostProcess: { kind: 'direct' },
        maxConcurrency: normalizedMaxConcurrency(workerPoolExecution),
        maxWorkers: workerPoolExecution?.maxWorkers ?? null,
        processModel: 'worker-pool',
        scheduling,
        workDistribution: normalizedWorkDistribution(execution),
        workerLifecycle: normalizeWorkerLifecycle(execution)
    };
}

function normalizeIntegrationExecution(
    execution: RunProjectIntegrationExecution | undefined
): RunIntegrationExecution {
    const processModel = execution?.processModel ?? defaultIntegrationProcessModel;
    const scheduling = execution?.scheduling ?? defaultIntegrationScheduling;

    if (processModel === 'worker-pool') {
        return normalizeWorkerPoolExecution(execution, scheduling);
    }

    return {
        maxConcurrency: normalizedMaxConcurrency(execution),
        processModel,
        scheduling
    };
}

function normalizeMicrotestProfile(
    profile: RunProjectMicrotestProfileConfig,
    configPath: string | null
): RunMicrotestProfileConfig {
    const timeouts = normalizeTimeouts(profile.timeouts, defaultTimeoutPolicy);

    assertValidTimeouts(timeouts);

    return {
        coverage: normalizeCoveragePolicy(profile.coverage, configPath),
        execution: normalizeMicrotestExecution(profile.execution),
        files: normalizeProfileFiles(profile.files),
        reporters: normalizeReporters(profile.reporters),
        resourceUsage: normalizeResourceUsage(profile.resourceUsage),
        testFamily: 'microtest',
        timings: normalizeTimings(profile.timings),
        timeouts
    };
}

function normalizeIntegrationProfile(profile: RunProjectIntegrationProfileConfig): RunIntegrationProfileConfig {
    const timeouts = normalizeTimeouts(profile.timeouts, defaultIntegrationTimeoutPolicy);
    const files = normalizeRequiredProfileFiles(profile.files);
    const execution = normalizeIntegrationExecution(profile.execution);

    assertValidTimeouts(timeouts);
    assertValidWorkDistribution(execution, files);
    assertValidWorkerPoolHedging(execution);

    return {
        execution,
        files,
        reporters: normalizeReporters(profile.reporters),
        retries: profile.retries === undefined ? null : {
            artifacts: profile.retries.artifacts ?? 'first-failure-and-final',
            maxAttempts: profile.retries.maxAttempts
        },
        resourceUsage: normalizeResourceUsage(profile.resourceUsage),
        testFamily: 'integration',
        timings: normalizeTimings(profile.timings),
        timeouts
    };
}

function normalizeProfile(profile: RunProjectProfileConfig, configPath: string | null): RunProfileConfig {
    if (profile.testFamily === 'integration') {
        return normalizeIntegrationProfile(profile);
    }

    return normalizeMicrotestProfile(profile, configPath);
}

function defaultMicrotestProfile(): RunMicrotestProfileConfig {
    return normalizeMicrotestProfile({ testFamily: 'microtest' }, null);
}

function normalizeConfiguredProfiles(
    profiles: RunProjectProfilesConfig | undefined,
    configPath: string | null
): RunProfilesConfig {
    const normalizedProfiles: Record<string, RunProfileConfig> = {};
    const profileEntries = Object.entries(profiles ?? {});

    for (const [ profileName, profile ] of profileEntries) {
        assertValidProfileName(profileName);
        normalizedProfiles[profileName] = normalizeProfile(profile, configPath);
    }

    if (normalizedProfiles.microtest === undefined) {
        normalizedProfiles.microtest = defaultMicrotestProfile();
    }

    return normalizedProfiles;
}

function normalizeConfig(parsedConfig: RunProjectConfig, configPath: string | null): LoadedRunConfig {
    return {
        configPath,
        loader: parsedConfig.loader ?? defaultLoader,
        outputRenderer: parsedConfig.outputRenderer ?? createPlainOutputRenderer(),
        profiles: normalizeConfiguredProfiles(parsedConfig.profiles, configPath),
        reporters: normalizeReporters(parsedConfig.reporters),
        runtimeStateDir: parsedConfig.runtimeStateDir ?? '.overkill'
    };
}

function parseConfig(configValue: unknown, configPath: string): RunProjectConfig {
    try {
        const parsedConfig: RunProjectConfig = parse(projectConfigSchema, configValue);

        return parsedConfig;
    } catch (error: unknown) {
        throw new RunConfigError(`Invalid config file "${configPath}": ${String(error)}`, { cause: error });
    }
}

export function createRunConfigLoader(dependencies: RunConfigLoaderDependencies): RunConfigLoader {
    return async function loadRunConfig(request) {
        const configPath = await resolveConfigPath(request, dependencies);

        if (configPath === null) {
            return normalizeConfig({}, null);
        }

        const configModule = await importConfigModule(configPath, dependencies);
        const configValue = readNamedConfigExport(configModule, configPath);

        return normalizeConfig(parseConfig(configValue, configPath), configPath);
    };
}
