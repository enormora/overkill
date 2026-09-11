import path from 'node:path';
import { parse } from '@schema-hub/zod-error-formatter';
import type { NonEmptyReadonlyArray } from '../assertion-protocol/assertion-node-shape.ts';
import { createPlainOutputRenderer, type DefinedOutputRenderer } from '../engine/reporter-output.ts';
import type { DefinedReporter } from '../engine/reporter.ts';
import {
    projectConfigSchema,
    type RunProjectConfig as ParsedRunProjectConfig,
    type RunProjectIntegrationExecution as ParsedRunProjectIntegrationExecution,
    type RunProjectIntegrationProfileConfig as ParsedRunProjectIntegrationProfileConfig,
    type RunProjectMeasuredResourceUsage as ParsedRunProjectMeasuredResourceUsage,
    type RunProjectMicrotestExecution as ParsedRunProjectMicrotestExecution,
    type RunProjectMicrotestProfileConfig as ParsedRunProjectMicrotestProfileConfig,
    type RunProjectProfileFiles as ParsedRunProjectProfileFiles,
    type RunProjectProfileConfig as ParsedRunProjectProfileConfig,
    type RunProjectProfilesConfig as ParsedRunProjectProfilesConfig,
    type RunProjectResourceBudgets as ParsedRunProjectResourceBudgets,
    type RunProjectResourceUsageConfig as ParsedRunProjectResourceUsageConfig,
    type RunProjectTimeoutConfig as ParsedRunProjectTimeoutConfig,
    type RunProjectUnmeasuredResourceUsage as ParsedRunProjectUnmeasuredResourceUsage
} from './run-config-schema.ts';
import {
    invalidRunProfileNameMessage,
    invalidRunProfileFileSetNameMessage,
    type RunIntegrationExecution,
    type RunIntegrationProfileConfig,
    type RunLoaderConfig,
    type RunMicrotestExecution,
    type RunMicrotestProfileConfig,
    type RunProfileFileSet,
    type RunProfileFiles,
    type RunProfileConfig,
    type RunProfilesConfig,
    type RunResourceBudgets,
    type RunResourceUsagePolicy,
    type RunTimeoutPolicy
} from './run-types.ts';
import {
    invalidProfileFileGlobConfigMessage
} from './profile-file-glob.ts';

export type RunProjectConfig = ParsedRunProjectConfig;
export type RunProjectIntegrationExecution = ParsedRunProjectIntegrationExecution;
export type RunProjectIntegrationProfileConfig = ParsedRunProjectIntegrationProfileConfig;
export type RunProjectMeasuredResourceUsage = ParsedRunProjectMeasuredResourceUsage;
export type RunProjectMicrotestExecution = ParsedRunProjectMicrotestExecution;
export type RunProjectMicrotestProfileConfig = ParsedRunProjectMicrotestProfileConfig;
export type RunProjectProfileFiles = ParsedRunProjectProfileFiles;
export type RunProjectProfileConfig = ParsedRunProjectProfileConfig;
export type RunProjectProfilesConfig = ParsedRunProjectProfilesConfig;
export type RunProjectResourceBudgets = ParsedRunProjectResourceBudgets;
export type RunProjectResourceUsageConfig = ParsedRunProjectResourceUsageConfig;
export type RunProjectTimeoutConfig = ParsedRunProjectTimeoutConfig;
export type RunProjectUnmeasuredResourceUsage = ParsedRunProjectUnmeasuredResourceUsage;

const defaultConfigFileNames = [ 'overkill.config.ts', 'overkill.config.js' ];
const defaultResourceUsageSamplingIntervalMilliseconds = 100;
const defaultMicrotestCollectionTimeoutMilliseconds = 1000;
const defaultMicrotestHardTimeoutMilliseconds = 1000;
const defaultMicrotestTimeoutMilliseconds = 500;
const defaultIntegrationCollectionTimeoutMilliseconds = 5000;
const defaultIntegrationHardTimeoutMilliseconds = 7000;
const defaultIntegrationTimeoutMilliseconds = 5000;

export type LoadedRunConfig = {
    readonly configPath: string | null;
    readonly loader: RunLoaderConfig;
    readonly outputRenderer: DefinedOutputRenderer;
    readonly profiles: RunProfilesConfig;
    readonly reporters: NonEmptyReadonlyArray<DefinedReporter> | null;
    readonly runtimeStateDir: string;
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

export class RunConfigError extends Error {
    public constructor(message: string, options?: Readonly<ErrorOptions>) {
        super(message, options);
        this.name = 'RunConfigError';
    }
}

const defaultLoader: RunLoaderConfig = {
    sourceMaps: false,
    stripMode: 'strip-only'
};

const defaultResourceUsagePolicy: RunResourceUsagePolicy = {
    budgets: {
        activeResourceCount: null,
        javaScriptEngineHeapBytes: null,
        residentSetBytes: null,
        residentSetGrowthBytesPerSecond: null
    },
    measure: false,
    samplingIntervalMilliseconds: defaultResourceUsageSamplingIntervalMilliseconds
};

const defaultTimeoutPolicy: RunTimeoutPolicy = {
    collectionMilliseconds: defaultMicrotestCollectionTimeoutMilliseconds,
    hardMilliseconds: defaultMicrotestHardTimeoutMilliseconds,
    softMilliseconds: defaultMicrotestTimeoutMilliseconds
};

const defaultIntegrationTimeoutPolicy: RunTimeoutPolicy = {
    collectionMilliseconds: defaultIntegrationCollectionTimeoutMilliseconds,
    hardMilliseconds: defaultIntegrationHardTimeoutMilliseconds,
    softMilliseconds: defaultIntegrationTimeoutMilliseconds
};

const defaultMicrotestExecution: RunMicrotestExecution = {
    processModel: 'supervised-process',
    scheduling: 'concurrent'
};

const defaultIntegrationExecution: RunIntegrationExecution = {
    processModel: 'worker-pool',
    scheduling: 'concurrent'
};

type ProjectProfileFilePatterns = {
    readonly exclude?: readonly string[] | undefined;
    readonly include: NonEmptyReadonlyArray<string>;
};

type ProjectProfileFileSets = {
    readonly sets: Readonly<Record<string, ProjectProfileFilePatterns>>;
};

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

function assertValidProfileGlob(field: string, pattern: string): void {
    const message = invalidProfileFileGlobConfigMessage(field, pattern);

    if (message !== null) {
        throw new RunConfigError(message);
    }
}

function profileFileGlobField(fieldPrefix: string | null, field: 'exclude' | 'include'): string {
    return fieldPrefix === null ? field : `${fieldPrefix}.${field}`;
}

function normalizeProfileFilePatterns(
    files: ProjectProfileFilePatterns,
    fieldPrefix: string | null
): RunProfileFileSet {
    for (const pattern of files.include) {
        assertValidProfileGlob(profileFileGlobField(fieldPrefix, 'include'), pattern);
    }

    const excludePatterns = files.exclude ?? [];

    for (const pattern of excludePatterns) {
        assertValidProfileGlob(profileFileGlobField(fieldPrefix, 'exclude'), pattern);
    }

    return {
        exclude: Array.from(excludePatterns),
        include: [ files.include[0], ...files.include.slice(1) ]
    };
}

function assertValidProfileFileSetName(name: string): void {
    const message = invalidRunProfileFileSetNameMessage(name);

    if (message !== null) {
        throw new RunConfigError(message);
    }
}

function normalizeProfileFileSets(files: ProjectProfileFileSets): RunProfileFiles {
    const entries = Object.entries(files.sets);

    if (entries.length === 0) {
        throw new RunConfigError('Invalid profile files.sets: at least one file set is required.');
    }

    return {
        sets: Object.fromEntries(entries.map(function normalizeProfileFileSet([ name, set ]) {
            assertValidProfileFileSetName(name);

            return [ name, normalizeProfileFilePatterns(set, `sets.${name}`) ];
        }))
    };
}

function hasProfileFileSets(files: RunProjectProfileFiles): files is ProjectProfileFileSets {
    return files.sets !== undefined;
}

function normalizeProfileFiles(files: RunProjectProfileFiles | undefined): RunProfileFiles | null {
    if (files === undefined) {
        return null;
    }

    if (hasProfileFileSets(files)) {
        return normalizeProfileFileSets(files);
    }

    return normalizeProfileFilePatterns(files, null);
}

function normalizeRequiredProfileFiles(files: RunProjectProfileFiles): RunProfileFiles {
    const normalizedFiles = normalizeProfileFiles(files);

    if (normalizedFiles === null) {
        throw new RunConfigError('Integration profiles require files.');
    }

    return normalizedFiles;
}

function normalizeMicrotestExecution(execution: RunProjectMicrotestExecution | undefined): RunMicrotestExecution {
    return {
        processModel: execution?.processModel ?? defaultMicrotestExecution.processModel,
        scheduling: execution?.scheduling ?? defaultMicrotestExecution.scheduling
    };
}

function normalizeIntegrationExecution(
    execution: RunProjectIntegrationExecution | undefined
): RunIntegrationExecution {
    return {
        processModel: execution?.processModel ?? defaultIntegrationExecution.processModel,
        scheduling: execution?.scheduling ?? defaultIntegrationExecution.scheduling
    };
}

function normalizeMicrotestProfile(profile: RunProjectMicrotestProfileConfig): RunMicrotestProfileConfig {
    const timeouts = normalizeTimeouts(profile.timeouts, defaultTimeoutPolicy);

    assertValidTimeouts(timeouts);

    return {
        execution: normalizeMicrotestExecution(profile.execution),
        files: normalizeProfileFiles(profile.files),
        reporters: normalizeReporters(profile.reporters),
        resourceUsage: normalizeResourceUsage(profile.resourceUsage),
        testFamily: 'microtest',
        timeouts
    };
}

function normalizeIntegrationProfile(profile: RunProjectIntegrationProfileConfig): RunIntegrationProfileConfig {
    const timeouts = normalizeTimeouts(profile.timeouts, defaultIntegrationTimeoutPolicy);

    assertValidTimeouts(timeouts);

    return {
        execution: normalizeIntegrationExecution(profile.execution),
        files: normalizeRequiredProfileFiles(profile.files),
        reporters: normalizeReporters(profile.reporters),
        resourceUsage: normalizeResourceUsage(profile.resourceUsage),
        testFamily: 'integration',
        timeouts
    };
}

function normalizeProfile(profile: RunProjectProfileConfig): RunProfileConfig {
    if (profile.testFamily === 'integration') {
        return normalizeIntegrationProfile(profile);
    }

    return normalizeMicrotestProfile(profile);
}

function assertValidProfileName(profileName: string): void {
    const message = invalidRunProfileNameMessage(profileName);

    if (message !== null) {
        throw new RunConfigError(message);
    }
}

function defaultMicrotestProfile(): RunMicrotestProfileConfig {
    return normalizeMicrotestProfile({ testFamily: 'microtest' });
}

function normalizeConfiguredProfiles(profiles: RunProjectProfilesConfig | undefined): RunProfilesConfig {
    const normalizedProfiles: Record<string, RunProfileConfig> = {};
    const profileEntries = Object.entries(profiles ?? {});

    for (const [ profileName, profile ] of profileEntries) {
        assertValidProfileName(profileName);
        normalizedProfiles[profileName] = normalizeProfile(profile);
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
        profiles: normalizeConfiguredProfiles(parsedConfig.profiles),
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
