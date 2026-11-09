import path from 'node:path';
import type { z } from 'zod/v4';
import { parse } from '@schema-hub/zod-error-formatter';
import { ordinaryBaselinePolicySchema, resolveStrictBaselines } from './baseline-policy.ts';
import {
    attachmentLimitsSchema,
    type ProjectAttachmentLimits as ParsedProjectAttachmentLimits,
    type integrationProfileSchema,
    projectConfigSchema,
    type ProjectAdapterProfileConfig,
    workerPoolProjectExecution,
    type Config as ParsedProjectConfig,
    type ProjectBenchmarkProfileConfig,
    type ProjectPropertyProfileConfig as PropertyProfileInput,
    type ParsedPropertyProfileConfig,
    type ProjectCoverageOutput as ParsedProjectCoverageOutput,
    type ProjectCoveragePolicy as ParsedProjectCoveragePolicy,
    type ProjectCoverageSources as ParsedProjectCoverageSources,
    type ProjectCoverageThresholds as ParsedProjectCoverageThresholds,
    type ProjectIntegrationExecution as ParsedProjectIntegrationExecution,
    type ProjectIntegrationProfileConfig as ParsedProjectIntegrationProfileConfig,
    type ProjectMeasuredProcessUsage as ParsedProjectMeasuredProcessUsage,
    type ProjectMicrotestExecution as ParsedProjectMicrotestExecution,
    type ProjectMicrotestProfileConfig as ParsedProjectMicrotestProfileConfig,
    type ProjectProfileFiles as ParsedProjectProfileFiles,
    type ProjectProcessBudgets as ParsedProjectProcessBudgets,
    type ProjectProcessUsageConfig as ParsedProjectProcessUsageConfig,
    type ProjectTimingProfilePolicy as ParsedProjectTimingProfilePolicy,
    type ProjectTimeoutConfig as ParsedProjectTimeoutConfig,
    type ProjectUnmeasuredProcessUsage as ParsedProjectUnmeasuredProcessUsage
} from './schema.ts';
import type {
    BenchmarkExecution,
    BenchmarkProfileConfig,
    ConfigLoadRequest as ConfigLoaderRequest,
    IntegrationExecution,
    IntegrationProfileConfig,
    MicrotestProfileConfig,
    NormalizedConfig,
    ProcessBudgets,
    ProcessUsagePolicy,
    ProfileConfig,
    ProfilesConfig,
    PropertyProfileConfig,
    TimeoutPolicy,
    WorkerLifecycle,
    WorkerPoolAssignmentPolicy,
    WorkerPoolHedgingPolicy
} from './types.ts';
import {
    normalizeAdapterProfile,
    assertValidProfileName,
    assertValidWorkDistribution,
    normalizeCoveragePolicy,
    normalizeProfileFiles,
    normalizeRequiredProfileFiles,
    normalizeTimings,
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
    normalizeHistoryPolicy,
    defaultLoader,
    defaultOutputRenderer,
    defaultProcessUsagePolicy,
    defaultProcessUsageSamplingIntervalMilliseconds,
    defaultTimeoutPolicy,
    defaultWorkerLifecycle,
    defaultWorkerPoolAssignmentPolicy,
    defaultWorkerPoolDispatchPolicy,
    defaultWorkerPoolHedgingPolicy,
    normalizeMicrotestExecution,
    normalizedMaxConcurrency
} from './defaults.ts';

type ParsedProfiles = NonNullable<ParsedProjectConfig['profiles']>;
type ParsedProfile = ParsedProfiles[string];
type ParsedBenchmarkProfile = Extract<ParsedProfile, { readonly testFamily: 'benchmark'; }>;

type ProjectHostProcessGuard = Readonly<Partial<Record<'hostProcess', never>>>;
type ProjectRetryPolicyGuard = Readonly<Partial<Record<'retries', never>>>;

export type LoadedConfig = NormalizedConfig & { readonly configPath: string | null; };

export type ProjectIntegrationExecution = ParsedProjectIntegrationExecution & ProjectHostProcessGuard;
type IntegrationArtifactSettings = Pick<
    z.input<typeof integrationProfileSchema>,
    'attachments' | 'baselines' | 'retries'
>;
export type ProjectIntegrationProfileConfig = IntegrationArtifactSettings & {
    readonly coverage?: never;
    readonly execution?: ProjectIntegrationExecution | undefined;
    readonly files: ParsedProjectIntegrationProfileConfig['files'];
    readonly reporters?: ParsedProjectIntegrationProfileConfig['reporters'];
    readonly processUsage?: ParsedProjectIntegrationProfileConfig['processUsage'];
    readonly testFamily: ParsedProjectIntegrationProfileConfig['testFamily'];
    readonly runRecords?: ParsedProjectIntegrationProfileConfig['runRecords'];
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
export type ProjectPropertyProfileConfig = PropertyProfileInput;
type StandardTestProfileConfig = ProjectIntegrationProfileConfig | ProjectMicrotestProfileConfig;
type BuiltinProjectTestProfileConfig = ProjectPropertyProfileConfig | StandardTestProfileConfig;
type ProjectTestProfileConfig = BuiltinProjectTestProfileConfig | ProjectAdapterProfileConfig;
export type ProjectProfileConfig = ProjectBenchmarkProfileConfig | ProjectTestProfileConfig;
export type ProjectProfilesConfig = Readonly<Record<string, ProjectProfileConfig>>;
export type ProjectProcessBudgets = ParsedProjectProcessBudgets;
export type ProjectMeasuredProcessUsage = ParsedProjectMeasuredProcessUsage;
export type ProjectUnmeasuredProcessUsage = ParsedProjectUnmeasuredProcessUsage;
export type ProjectProcessUsageConfig = ParsedProjectProcessUsageConfig;
export type ProjectTimingProfilePolicy = ParsedProjectTimingProfilePolicy;
export type ProjectTimeoutConfig = ParsedProjectTimeoutConfig;
export type Config = {
    readonly history?: ParsedProjectConfig['history'];
    readonly loader?: ParsedProjectConfig['loader'];
    readonly outputRenderer?: ParsedProjectConfig['outputRenderer'];
    readonly profiles?: ProjectProfilesConfig | undefined;
    readonly reporters?: ParsedProjectConfig['reporters'];
    readonly runtimeStateDir?: ParsedProjectConfig['runtimeStateDir'];
};

export type ConfigLoadRequest = ConfigLoaderRequest;

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

function normalizeBudgetValue(value: number | null | undefined): number | null {
    return value ?? null;
}

function normalizeProcessBudgets(processBudgets: ProjectProcessBudgets | undefined): ProcessBudgets {
    return {
        activeResourceCount: normalizeBudgetValue(processBudgets?.activeResourceCount),
        javaScriptEngineHeapBytes: normalizeBudgetValue(processBudgets?.javaScriptEngineHeapBytes),
        residentSetBytes: normalizeBudgetValue(processBudgets?.residentSetBytes),
        residentSetGrowthBytesPerSecond: normalizeBudgetValue(processBudgets?.residentSetGrowthBytesPerSecond)
    };
}

function disabledProcessBudgets(): ProcessBudgets {
    return {
        activeResourceCount: null,
        javaScriptEngineHeapBytes: null,
        residentSetBytes: null,
        residentSetGrowthBytesPerSecond: null
    };
}

function copyProcessBudgets(processBudgets: ProcessBudgets): ProcessBudgets {
    return {
        activeResourceCount: processBudgets.activeResourceCount,
        javaScriptEngineHeapBytes: processBudgets.javaScriptEngineHeapBytes,
        residentSetBytes: processBudgets.residentSetBytes,
        residentSetGrowthBytesPerSecond: processBudgets.residentSetGrowthBytesPerSecond
    };
}

function copyProcessUsagePolicy(policy: ProcessUsagePolicy): ProcessUsagePolicy {
    return {
        budgets: copyProcessBudgets(policy.budgets),
        measure: policy.measure,
        samplingIntervalMilliseconds: policy.samplingIntervalMilliseconds
    };
}

function normalizeUnmeasuredProcessUsage(): ProcessUsagePolicy {
    return {
        budgets: disabledProcessBudgets(),
        measure: false,
        samplingIntervalMilliseconds: defaultProcessUsageSamplingIntervalMilliseconds
    };
}

function normalizeMeasuredProcessUsage(profile: ProjectMeasuredProcessUsage): ProcessUsagePolicy {
    return {
        budgets: normalizeProcessBudgets(profile.budgets),
        measure: true,
        samplingIntervalMilliseconds: profile.samplingIntervalMilliseconds ??
            defaultProcessUsageSamplingIntervalMilliseconds
    };
}

function normalizeProcessUsage(
    profile: ProjectProcessUsageConfig | undefined
): ProcessUsagePolicy {
    if (profile === undefined) {
        return copyProcessUsagePolicy(defaultProcessUsagePolicy);
    }

    if (profile.measure !== true) {
        return normalizeUnmeasuredProcessUsage();
    }

    return normalizeMeasuredProcessUsage(profile);
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

function normalizeProfilePolicy(
    profile: Exclude<ProjectProfileConfig, ProjectAdapterProfileConfig>,
    defaults: TimeoutPolicy
): Pick<ProfileConfig, 'processUsage' | 'reporters' | 'runRecords' | 'timeouts' | 'timings'> {
    const timeouts = normalizeTimeouts(profile.timeouts, defaults);
    assertValidTimeouts(timeouts);
    return {
        reporters: profile.reporters ?? null,
        processUsage: normalizeProcessUsage(profile.processUsage),
        runRecords: { persist: profile.runRecords?.persist ?? 'on-demand' },
        timings: normalizeTimings(profile.timings),
        timeouts
    };
}

function normalizeMicrotestProfile(
    profile: ProjectMicrotestProfileConfig,
    configPath: string | null
): MicrotestProfileConfig {
    const policy = normalizeProfilePolicy(profile, defaultTimeoutPolicy);

    return {
        ...policy,
        baselines: resolveStrictBaselines(profile.baselines ?? {}),
        coverage: normalizeCoveragePolicy(profile.coverage, configPath),
        execution: normalizeMicrotestExecution(profile.execution),
        files: normalizeProfileFiles(profile.files),
        testFamily: 'microtest'
    };
}

function normalizeIntegrationProfile(profile: ProjectIntegrationProfileConfig): IntegrationProfileConfig {
    const policy = normalizeProfilePolicy(profile, defaultIntegrationTimeoutPolicy);
    const files = normalizeRequiredProfileFiles(profile.files);
    const execution = normalizeIntegrationExecution(profile.execution);

    assertValidWorkDistribution(execution, files);
    assertValidWorkerPoolHedging(execution);

    return {
        ...policy,
        baselines: ordinaryBaselinePolicySchema.parse(profile.baselines ?? {}),
        attachments: attachmentLimitsSchema.parse(profile.attachments),
        execution,
        files,
        retries: profile.retries === undefined ? null : {
            artifacts: profile.retries.artifacts ?? 'first-failure-and-final',
            maxAttempts: profile.retries.maxAttempts
        },
        testFamily: 'integration'
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

function normalizeBenchmarkProfile(profile: ParsedBenchmarkProfile): BenchmarkProfileConfig {
    const policy = normalizeProfilePolicy(profile, defaultBenchmarkTimeoutPolicy);
    const execution = normalizeBenchmarkExecution(profile.execution);
    const files = normalizeRequiredProfileFiles(profile.files);

    validateBenchmarkExecution(execution, policy.timeouts);
    assertValidWorkDistribution(execution, files);

    return {
        ...policy,
        attachments: attachmentLimitsSchema.parse(profile.attachments),
        garbageCollection: profile.garbageCollection,
        baselines: profile.baselines,
        host: profile.host,
        execution,
        files,
        testFamily: 'benchmark'
    };
}

function normalizePropertyProfile(profile: ParsedPropertyProfileConfig): PropertyProfileConfig {
    const policy = normalizeProfilePolicy(profile, {
        collectionMilliseconds: 2000,
        softMilliseconds: 1000,
        hardMilliseconds: 2000
    });
    return {
        ...policy,
        execution: normalizeMicrotestExecution(profile.execution),
        files: normalizeRequiredProfileFiles(profile.files),
        baselines: resolveStrictBaselines(profile.baselines ?? {}),
        corpus: profile.corpus,
        property: profile.property,
        testFamily: 'property'
    };
}

function normalizeProfile(
    profile: ParsedProfile,
    configPath: string | null
): ProfileConfig {
    if (profile.testFamily === 'type-test') {
        return normalizeAdapterProfile(profile);
    }
    if (profile.testFamily === 'property') {
        return normalizePropertyProfile(profile);
    }
    if (profile.testFamily === 'benchmark') {
        return normalizeBenchmarkProfile(profile);
    }

    if (profile.testFamily === 'integration') {
        return normalizeIntegrationProfile(profile);
    }

    return normalizeMicrotestProfile(profile, configPath);
}

function normalizeConfiguredProfiles(
    profiles: ParsedProjectConfig['profiles'],
    configPath: string | null
): ProfilesConfig {
    const normalizedProfiles: Record<string, ProfileConfig> = {};
    const profileEntries = Object.entries(profiles ?? {});

    for (const [ profileName, profile ] of profileEntries) {
        assertValidProfileName(profileName);
        normalizedProfiles[profileName] = normalizeProfile(profile, configPath);
    }

    if (normalizedProfiles.microtest === undefined) {
        normalizedProfiles.microtest = normalizeMicrotestProfile({ testFamily: 'microtest' }, null);
    }

    return normalizedProfiles;
}

function normalizeConfigForOrigin(parsedConfig: ParsedProjectConfig, configPath: string | null): NormalizedConfig {
    return {
        history: normalizeHistoryPolicy(parsedConfig.history ?? {}),
        loader: parsedConfig.loader ?? defaultLoader,
        outputRenderer: parsedConfig.outputRenderer ?? defaultOutputRenderer,
        profiles: normalizeConfiguredProfiles(parsedConfig.profiles, configPath),
        reporters: parsedConfig.reporters ?? null,
        runtimeStateDir: parsedConfig.runtimeStateDir ?? '.overkill'
    };
}

function parseConfig(configValue: unknown, configPath: string | null): ParsedProjectConfig {
    try {
        return parse(projectConfigSchema, configValue);
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
