import path from 'node:path';
import type { z } from 'zod/v4';
import { parse } from '@schema-hub/zod-error-formatter';
import { createPlainOutputRenderer } from '../engine/reporter-output.ts';
import {
    attachmentLimitsSchema,
    type ProjectAttachmentLimits as ParsedProjectAttachmentLimits,
    type integrationProfileSchema,
    projectConfigSchema,
    workerPoolProjectExecution,
    type Config as ParsedProjectConfig,
    type ProjectBenchmarkProfileConfig,
    type ProjectCoverageOutput as ParsedProjectCoverageOutput,
    type ProjectCoveragePolicy as ParsedProjectCoveragePolicy,
    type ProjectCoverageSources as ParsedProjectCoverageSources,
    type ProjectCoverageThresholds as ParsedProjectCoverageThresholds,
    type ProjectIntegrationExecution as ParsedProjectIntegrationExecution,
    type ProjectIntegrationProfileConfig as ParsedProjectIntegrationProfileConfig,
    type ProjectMeasuredResourceUsage as ParsedProjectMeasuredResourceUsage,
    type ProjectMicrotestExecution as ParsedProjectMicrotestExecution,
    type ProjectMicrotestProfileConfig as ParsedProjectMicrotestProfileConfig,
    type ProjectProfileFiles as ParsedProjectProfileFiles,
    type ProjectResourceBudgets as ParsedProjectResourceBudgets,
    type ProjectResourceUsageConfig as ParsedProjectResourceUsageConfig,
    type ProjectTimingProfilePolicy as ParsedProjectTimingProfilePolicy,
    type ProjectTimeoutConfig as ParsedProjectTimeoutConfig,
    type ProjectUnmeasuredResourceUsage as ParsedProjectUnmeasuredResourceUsage
} from './schema.ts';
import type {
    BenchmarkExecution,
    BenchmarkProfileConfig,
    IntegrationExecution,
    IntegrationProfileConfig,
    MicrotestProfileConfig,
    ProfileConfig,
    ProfilesConfig,
    NormalizedConfig,
    ResourceBudgets,
    ResourceUsagePolicy,
    TimingProfilePolicy,
    TimeoutPolicy,
    WorkerPoolAssignmentPolicy,
    WorkerPoolHedgingPolicy,
    WorkerLifecycle
} from './types.ts';
import {
    assertValidProfileName,
    assertValidWorkDistribution,
    normalizeCoveragePolicy,
    normalizeProfileFiles,
    normalizeRequiredProfileFiles,
    normalizedWorkDistribution
} from './profile-normalization.ts';
import { ConfigError } from './config-error.ts';
import { validateBenchmarkExecution } from './benchmark-execution.ts';
import {
    defaultBenchmarkTimeoutPolicy,
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
} from './defaults.ts';

type ConfiguredReporters = NonNullable<ParsedProjectConfig['reporters']>;
type ProjectHostProcessGuard = Readonly<Partial<Record<'hostProcess', never>>>;
type ProjectRetryPolicyGuard = Readonly<Partial<Record<'retries', never>>>;

export type LoadedConfig = NormalizedConfig & { readonly configPath: string | null; };

export type ProjectIntegrationExecution = ParsedProjectIntegrationExecution & ProjectHostProcessGuard;
type IntegrationArtifactSettings = Pick<z.input<typeof integrationProfileSchema>, 'attachments' | 'retries'>;
export type ProjectIntegrationProfileConfig = IntegrationArtifactSettings & {
    readonly coverage?: never;
    readonly execution?: ProjectIntegrationExecution | undefined;
    readonly files: ParsedProjectIntegrationProfileConfig['files'];
    readonly reporters?: ParsedProjectIntegrationProfileConfig['reporters'];
    readonly resourceUsage?: ParsedProjectIntegrationProfileConfig['resourceUsage'];
    readonly testFamily: ParsedProjectIntegrationProfileConfig['testFamily'];
    readonly timings?: ParsedProjectIntegrationProfileConfig['timings'];
    readonly timeouts?: ParsedProjectIntegrationProfileConfig['timeouts'];
};
export type ProjectMicrotestExecution = ParsedProjectMicrotestExecution;
export type ProjectMicrotestProfileConfig = ParsedProjectMicrotestProfileConfig & ProjectRetryPolicyGuard;
export type ProjectCoverageOutput = ParsedProjectCoverageOutput;
export type ProjectCoveragePolicy = ParsedProjectCoveragePolicy;
export type ProjectCoverageSources = ParsedProjectCoverageSources;
export type ProjectCoverageThresholds = ParsedProjectCoverageThresholds;
export type ProjectProfileFiles = ParsedProjectProfileFiles;
type ProjectTestProfileConfig = ProjectIntegrationProfileConfig | ProjectMicrotestProfileConfig;
export type ProjectProfileConfig = ProjectBenchmarkProfileConfig | ProjectTestProfileConfig;
export type ProjectProfilesConfig = Readonly<Record<string, ProjectProfileConfig>>;
export type ProjectResourceBudgets = ParsedProjectResourceBudgets;
export type ProjectMeasuredResourceUsage = ParsedProjectMeasuredResourceUsage;
export type ProjectUnmeasuredResourceUsage = ParsedProjectUnmeasuredResourceUsage;
export type ProjectResourceUsageConfig = ParsedProjectResourceUsageConfig;
export type ProjectTimingProfilePolicy = ParsedProjectTimingProfilePolicy;
export type ProjectTimeoutConfig = ParsedProjectTimeoutConfig;
export type Config = {
    readonly loader?: ParsedProjectConfig['loader'];
    readonly outputRenderer?: ParsedProjectConfig['outputRenderer'];
    readonly profiles?: ProjectProfilesConfig | undefined;
    readonly reporters?: ParsedProjectConfig['reporters'];
    readonly runtimeStateDir?: ParsedProjectConfig['runtimeStateDir'];
};

export type ConfigLoadRequest = {
    readonly configPath: string | null;
    readonly cwd: string;
};

export type ConfigLoaderDependencies = {
    readonly fileExists: (filePath: string) => Promise<boolean>;
    readonly importModule: (configPath: string) => Promise<unknown>;
};

export type ConfigLoader = (request: ConfigLoadRequest) => Promise<LoadedConfig>;

export function defineConfig(config: Config): Config {
    return config;
}

async function discoverConfigPath(
    cwd: string,
    dependencies: ConfigLoaderDependencies
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
    request: ConfigLoadRequest,
    dependencies: ConfigLoaderDependencies
): Promise<string | null> {
    if (request.configPath !== null) {
        return path.resolve(request.cwd, request.configPath);
    }

    return await discoverConfigPath(request.cwd, dependencies);
}

async function importConfigModule(
    configPath: string,
    dependencies: ConfigLoaderDependencies
): Promise<unknown> {
    try {
        return await dependencies.importModule(configPath);
    } catch (error: unknown) {
        throw new ConfigError(`Failed to load config file "${configPath}".`, { cause: error });
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
        throw new ConfigError(`Config file "${configPath}" must only export a named config value.`);
    }
}

function readNamedConfigExport(configModule: unknown, configPath: string): unknown {
    if (hasDefaultExport(configModule)) {
        throw new ConfigError(`Config file "${configPath}" must not export a default config.`);
    }

    if (hasNamedConfigExport(configModule)) {
        assertNoExtraConfigExports(configModule, configPath);

        return configModule.config;
    }

    throw new ConfigError(`Config file "${configPath}" must export a named config value.`);
}

function normalizeReporters(
    reporters: ConfiguredReporters | undefined
): LoadedConfig['reporters'] {
    return reporters ?? null;
}

function normalizeBudgetValue(value: number | null | undefined): number | null {
    return value ?? null;
}

function normalizeResourceBudgets(resourceBudgets: ProjectResourceBudgets | undefined): ResourceBudgets {
    return {
        activeResourceCount: normalizeBudgetValue(resourceBudgets?.activeResourceCount),
        javaScriptEngineHeapBytes: normalizeBudgetValue(resourceBudgets?.javaScriptEngineHeapBytes),
        residentSetBytes: normalizeBudgetValue(resourceBudgets?.residentSetBytes),
        residentSetGrowthBytesPerSecond: normalizeBudgetValue(resourceBudgets?.residentSetGrowthBytesPerSecond)
    };
}

function disabledResourceBudgets(): ResourceBudgets {
    return {
        activeResourceCount: null,
        javaScriptEngineHeapBytes: null,
        residentSetBytes: null,
        residentSetGrowthBytesPerSecond: null
    };
}

function copyResourceBudgets(resourceBudgets: ResourceBudgets): ResourceBudgets {
    return {
        activeResourceCount: resourceBudgets.activeResourceCount,
        javaScriptEngineHeapBytes: resourceBudgets.javaScriptEngineHeapBytes,
        residentSetBytes: resourceBudgets.residentSetBytes,
        residentSetGrowthBytesPerSecond: resourceBudgets.residentSetGrowthBytesPerSecond
    };
}

function copyResourceUsagePolicy(policy: ResourceUsagePolicy): ResourceUsagePolicy {
    return {
        budgets: copyResourceBudgets(policy.budgets),
        measure: policy.measure,
        samplingIntervalMilliseconds: policy.samplingIntervalMilliseconds
    };
}

function normalizeUnmeasuredResourceUsage(): ResourceUsagePolicy {
    return {
        budgets: disabledResourceBudgets(),
        measure: false,
        samplingIntervalMilliseconds: defaultResourceUsageSamplingIntervalMilliseconds
    };
}

function normalizeMeasuredResourceUsage(profile: ProjectMeasuredResourceUsage): ResourceUsagePolicy {
    return {
        budgets: normalizeResourceBudgets(profile.budgets),
        measure: true,
        samplingIntervalMilliseconds: profile.samplingIntervalMilliseconds ??
            defaultResourceUsageSamplingIntervalMilliseconds
    };
}

function normalizeResourceUsage(
    profile: ProjectResourceUsageConfig | undefined
): ResourceUsagePolicy {
    if (profile === undefined) {
        return copyResourceUsagePolicy(defaultResourceUsagePolicy);
    }

    if (profile.measure !== true) {
        return normalizeUnmeasuredResourceUsage();
    }

    return normalizeMeasuredResourceUsage(profile);
}

function normalizeTimings(timings: ProjectTimingProfilePolicy | undefined): TimingProfilePolicy {
    return { collection: timings?.collection ?? defaultTimingProfilePolicy.collection };
}

function timeoutValue(value: number | undefined, fallback: number): number {
    return value ?? fallback;
}

function normalizeTimeouts(
    timeouts: ProjectTimeoutConfig | undefined,
    defaultPolicy: TimeoutPolicy
): TimeoutPolicy {
    return {
        collectionMilliseconds: timeoutValue(timeouts?.collectionMilliseconds, defaultPolicy.collectionMilliseconds),
        hardMilliseconds: timeoutValue(timeouts?.hardMilliseconds, defaultPolicy.hardMilliseconds),
        softMilliseconds: timeoutValue(timeouts?.softMilliseconds, defaultPolicy.softMilliseconds)
    };
}

function assertValidTimeouts(timeouts: TimeoutPolicy): void {
    if (timeouts.softMilliseconds > timeouts.hardMilliseconds) {
        throw new ConfigError(
            'Invalid profile timeouts: softMilliseconds must be less than or equal to hardMilliseconds.'
        );
    }
}

function normalizeWorkerLifecycle(execution: ProjectIntegrationExecution | undefined): WorkerLifecycle {
    if (execution?.processModel !== 'worker-pool') {
        return defaultWorkerLifecycle;
    }

    return execution.workerLifecycle ?? defaultWorkerLifecycle;
}

function normalizeWorkerPoolAssignmentPolicy(
    execution: ProjectIntegrationExecution | undefined
): WorkerPoolAssignmentPolicy {
    if (execution?.processModel !== 'worker-pool') {
        return defaultWorkerPoolAssignmentPolicy;
    }

    return execution.assignmentPolicy ?? defaultWorkerPoolAssignmentPolicy;
}

function normalizeWorkerPoolHedgingPolicy(
    execution: ProjectIntegrationExecution | undefined
): WorkerPoolHedgingPolicy {
    if (execution?.processModel !== 'worker-pool') {
        return defaultWorkerPoolHedgingPolicy;
    }

    return execution.hedging ?? defaultWorkerPoolHedgingPolicy;
}

function assertValidWorkerPoolHedging(execution: IntegrationExecution): void {
    if (
        execution.processModel === 'worker-pool' &&
        execution.hedging.mode === 'on' &&
        execution.dispatchPolicy === 'static-assignment'
    ) {
        throw new ConfigError('Invalid worker-pool hedging: hedging requires dynamic-lease dispatch.');
    }
}

function normalizeWorkerPoolExecution(
    execution: ProjectIntegrationExecution | undefined,
    scheduling: IntegrationExecution['scheduling']
): IntegrationExecution {
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
    execution: ProjectIntegrationExecution | undefined
): IntegrationExecution {
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
    profile: ProjectMicrotestProfileConfig,
    configPath: string | null
): MicrotestProfileConfig {
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

function normalizeIntegrationProfile(profile: ProjectIntegrationProfileConfig): IntegrationProfileConfig {
    const timeouts = normalizeTimeouts(profile.timeouts, defaultIntegrationTimeoutPolicy);
    const files = normalizeRequiredProfileFiles(profile.files);
    const execution = normalizeIntegrationExecution(profile.execution);

    assertValidTimeouts(timeouts);
    assertValidWorkDistribution(execution, files);
    assertValidWorkerPoolHedging(execution);

    return {
        attachments: attachmentLimitsSchema.parse(profile.attachments),
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

function normalizeBenchmarkExecution(
    execution: ProjectBenchmarkProfileConfig['execution']
): BenchmarkExecution {
    const serialExecution = {
        ...normalizeIntegrationExecution(execution),
        maxConcurrency: 1 as const,
        scheduling: 'serial' as const
    };

    return serialExecution.processModel === 'worker-pool'
        ? { ...serialExecution, hedging: { mode: 'off' } }
        : serialExecution;
}

function normalizeBenchmarkProfile(profile: ProjectBenchmarkProfileConfig): BenchmarkProfileConfig {
    const timeouts = normalizeTimeouts(profile.timeouts, defaultBenchmarkTimeoutPolicy);
    const execution = normalizeBenchmarkExecution(profile.execution);
    const files = normalizeRequiredProfileFiles(profile.files);

    assertValidTimeouts(timeouts);
    validateBenchmarkExecution(execution, timeouts);
    assertValidWorkDistribution(execution, files);

    return {
        attachments: attachmentLimitsSchema.parse(profile.attachments),
        baselines: profile.baselines ?? { adapters: [], directory: 'test-baselines' },
        execution,
        files,
        reporters: normalizeReporters(profile.reporters),
        resourceUsage: normalizeResourceUsage(profile.resourceUsage),
        testFamily: 'benchmark',
        timings: normalizeTimings(profile.timings),
        timeouts
    };
}

function normalizeProfile(profile: ProjectProfileConfig, configPath: string | null): ProfileConfig {
    if (profile.testFamily === 'benchmark') {
        return normalizeBenchmarkProfile(profile);
    }

    if (profile.testFamily === 'integration') {
        return normalizeIntegrationProfile(profile);
    }

    return normalizeMicrotestProfile(profile, configPath);
}

function defaultMicrotestProfile(): MicrotestProfileConfig {
    return normalizeMicrotestProfile({ testFamily: 'microtest' }, null);
}

function normalizeConfiguredProfiles(
    profiles: ProjectProfilesConfig | undefined,
    configPath: string | null
): ProfilesConfig {
    const normalizedProfiles: Record<string, ProfileConfig> = {};
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

function normalizeConfigForOrigin(parsedConfig: Config, configPath: string | null): NormalizedConfig {
    return {
        loader: parsedConfig.loader ?? defaultLoader,
        outputRenderer: parsedConfig.outputRenderer ?? createPlainOutputRenderer(),
        profiles: normalizeConfiguredProfiles(parsedConfig.profiles, configPath),
        reporters: normalizeReporters(parsedConfig.reporters),
        runtimeStateDir: parsedConfig.runtimeStateDir ?? '.overkill'
    };
}

function parseConfig(configValue: unknown, configPath: string | null): Config {
    try {
        const parsedConfig: Config = parse(projectConfigSchema, configValue);

        return parsedConfig;
    } catch (error: unknown) {
        const location = configPath === null ? 'Invalid config' : `Invalid config file "${configPath}"`;

        throw new ConfigError(`${location}: ${String(error)}`, { cause: error });
    }
}

export function normalizeConfig(config: Config): NormalizedConfig {
    return normalizeConfigForOrigin(parseConfig(config, null), null);
}

export function createConfigLoader(dependencies: ConfigLoaderDependencies): ConfigLoader {
    return async function loadConfig(request) {
        const configPath = await resolveConfigPath(request, dependencies);

        if (configPath === null) {
            return { ...normalizeConfigForOrigin({}, null), configPath: null };
        }

        const configModule = await importConfigModule(configPath, dependencies);
        const configValue = readNamedConfigExport(configModule, configPath);

        return { ...normalizeConfigForOrigin(parseConfig(configValue, configPath), configPath), configPath };
    };
}

export type ProjectAttachmentLimits = ParsedProjectAttachmentLimits;
