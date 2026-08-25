import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from '@schema-hub/zod-error-formatter';
import type { NonEmptyReadonlyArray } from '../assertion-protocol/assertion-node-shape.ts';
import { createPlainOutputRenderer, type OutputRenderer } from '../engine/reporter-output.ts';
import type { Reporter } from '../engine/reporter.ts';
import {
    projectConfigSchema,
    type RunProjectConfig as ParsedRunProjectConfig,
    type RunProjectMeasuredResourceUsage as ParsedRunProjectMeasuredResourceUsage,
    type RunProjectMicrotestExecution as ParsedRunProjectMicrotestExecution,
    type RunProjectMicrotestProfileConfig as ParsedRunProjectMicrotestProfileConfig,
    type RunProjectProfileConfig as ParsedRunProjectProfileConfig,
    type RunProjectProfilesConfig as ParsedRunProjectProfilesConfig,
    type RunProjectResourceBudgets as ParsedRunProjectResourceBudgets,
    type RunProjectResourceUsageConfig as ParsedRunProjectResourceUsageConfig,
    type RunProjectTimeoutConfig as ParsedRunProjectTimeoutConfig,
    type RunProjectUnmeasuredResourceUsage as ParsedRunProjectUnmeasuredResourceUsage
} from './run-config-schema.ts';
import {
    invalidRunProfileNameMessage,
    type RunLoaderConfig,
    type RunMicrotestExecution,
    type RunMicrotestProfileConfig,
    type RunProfileConfig,
    type RunProfilesConfig,
    type RunResourceBudgets,
    type RunResourceUsagePolicy,
    type RunTimeoutPolicy
} from './run-types.ts';

export type RunProjectConfig = ParsedRunProjectConfig;
export type RunProjectMeasuredResourceUsage = ParsedRunProjectMeasuredResourceUsage;
export type RunProjectMicrotestExecution = ParsedRunProjectMicrotestExecution;
export type RunProjectMicrotestProfileConfig = ParsedRunProjectMicrotestProfileConfig;
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

export type LoadedRunConfig = {
    readonly configPath: string | null;
    readonly loader: RunLoaderConfig;
    readonly outputRenderer: OutputRenderer;
    readonly profiles: RunProfilesConfig;
    readonly reporters: NonEmptyReadonlyArray<Reporter> | null;
    readonly runtimeStateDir: string;
};

export type RunConfigLoadRequest = {
    readonly configPath: string | null;
    readonly cwd: string;
};

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

const defaultMicrotestExecution: RunMicrotestExecution = {
    processModel: 'supervised-process',
    scheduling: 'concurrent'
};

export function defineConfig(config: RunProjectConfig): RunProjectConfig {
    return config;
}

async function fileExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);

        return true;
    } catch {
        return false;
    }
}

async function discoverConfigPath(cwd: string): Promise<string | null> {
    for (const configFileName of defaultConfigFileNames) {
        const candidate = path.resolve(cwd, configFileName);

        if (await fileExists(candidate)) {
            return candidate;
        }
    }

    return null;
}

async function resolveConfigPath(request: RunConfigLoadRequest): Promise<string | null> {
    if (request.configPath !== null) {
        return path.resolve(request.cwd, request.configPath);
    }

    return await discoverConfigPath(request.cwd);
}

async function importConfigModule(configPath: string): Promise<unknown> {
    try {
        return await import(pathToFileURL(configPath).href);
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

function normalizeReporters(reporters: NonEmptyReadonlyArray<Reporter> | undefined): LoadedRunConfig['reporters'] {
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

function normalizeTimeouts(timeouts: RunProjectTimeoutConfig | undefined): RunTimeoutPolicy {
    return {
        collectionMilliseconds: timeoutValue(timeouts?.collectionMilliseconds, defaultTimeoutPolicy.collectionMilliseconds),
        hardMilliseconds: timeoutValue(timeouts?.hardMilliseconds, defaultTimeoutPolicy.hardMilliseconds),
        softMilliseconds: timeoutValue(timeouts?.softMilliseconds, defaultTimeoutPolicy.softMilliseconds)
    };
}

function assertValidTimeouts(timeouts: RunTimeoutPolicy): void {
    if (timeouts.softMilliseconds > timeouts.hardMilliseconds) {
        throw new RunConfigError(
            'Invalid profile timeouts: softMilliseconds must be less than or equal to hardMilliseconds.'
        );
    }
}

function normalizeExecution(execution: RunProjectMicrotestExecution | undefined): RunMicrotestExecution {
    return {
        processModel: execution?.processModel ?? defaultMicrotestExecution.processModel,
        scheduling: execution?.scheduling ?? defaultMicrotestExecution.scheduling
    };
}

function normalizeMicrotestProfile(profile: RunProjectMicrotestProfileConfig): RunMicrotestProfileConfig {
    const timeouts = normalizeTimeouts(profile.timeouts);

    assertValidTimeouts(timeouts);

    return {
        execution: normalizeExecution(profile.execution),
        reporters: normalizeReporters(profile.reporters),
        resourceUsage: normalizeResourceUsage(profile.resourceUsage),
        testFamily: 'microtest',
        timeouts
    };
}

const profileNormalizers: Readonly<
    Record<RunProjectProfileConfig['testFamily'], (profile: RunProjectProfileConfig) => RunProfileConfig>
> = {
    microtest: normalizeMicrotestProfile
};

function normalizeProfile(profile: RunProjectProfileConfig): RunProfileConfig {
    return profileNormalizers[profile.testFamily](profile);
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

export async function loadRunConfig(request: RunConfigLoadRequest): Promise<LoadedRunConfig> {
    const configPath = await resolveConfigPath(request);

    if (configPath === null) {
        return normalizeConfig({}, null);
    }

    const configModule = await importConfigModule(configPath);
    const configValue = readNamedConfigExport(configModule, configPath);

    return normalizeConfig(parseConfig(configValue, configPath), configPath);
}
