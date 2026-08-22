import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from '@schema-hub/zod-error-formatter';
import { z } from 'zod/v4';
import type { NonEmptyReadonlyArray } from '../assertion-protocol/assertion-node-shape.ts';
import {
    createPlainOutputRenderer,
    isOutputRenderer,
    type DefinedOutputRenderer,
    type OutputRenderer
} from '../engine/reporter-output.ts';
import { isReporter, type DefinedReporter, type Reporter } from '../engine/reporter.ts';
import {
    invalidRunProfileNameMessage,
    type RunLoaderConfig,
    type RunMicrotestExecution,
    type RunMicrotestProfileConfig,
    type RunProfilesConfig,
    type RunResourceBudgets,
    type RunResourceUsagePolicy,
    type RunTimeoutPolicy
} from './run-types.ts';

const defaultConfigFileNames = [ 'overkill.config.ts', 'overkill.config.js' ];
const defaultResourceUsageSamplingIntervalMilliseconds = 100;
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
    hardMilliseconds: defaultMicrotestHardTimeoutMilliseconds,
    softMilliseconds: defaultMicrotestTimeoutMilliseconds
};

const defaultMicrotestExecution: RunMicrotestExecution = {
    processModel: 'supervised-process',
    scheduling: 'concurrent'
};

const reporterSchema = z.custom<DefinedReporter>(isReporter, 'must be created with defineReporter(...)');

const outputRendererSchema = z.custom<DefinedOutputRenderer>(
    isOutputRenderer,
    'must be created with defineOutputRenderer(...)'
);

const loaderSchema = z
    .strictObject({
        sourceMaps: z.boolean(),
        stripMode: z.literal('strip-only')
    })
    .readonly();

const positiveSafeIntegerSchema = z.number().refine(function isPositiveSafeInteger(value) {
    return Number.isSafeInteger(value) && value > 0;
}, 'must be a positive safe integer');

const resourceBudgetsSchema = z
    .strictObject({
        activeResourceCount: z.optional(z.nullable(positiveSafeIntegerSchema)),
        javaScriptEngineHeapBytes: z.optional(z.nullable(positiveSafeIntegerSchema)),
        residentSetBytes: z.optional(z.nullable(positiveSafeIntegerSchema)),
        residentSetGrowthBytesPerSecond: z.optional(z.nullable(positiveSafeIntegerSchema))
    })
    .readonly();

const measuredResourceUsageSchema = z
    .strictObject({
        budgets: z.optional(resourceBudgetsSchema),
        measure: z.literal(true),
        samplingIntervalMilliseconds: z.optional(positiveSafeIntegerSchema)
    })
    .readonly();

const unmeasuredResourceUsageSchema = z
    .strictObject({
        measure: z.optional(z.literal(false))
    })
    .readonly();

const resourceUsageSchema = z.union([ measuredResourceUsageSchema, unmeasuredResourceUsageSchema ]);

const timeoutSchema = z
    .strictObject({
        hardMilliseconds: z.optional(positiveSafeIntegerSchema),
        softMilliseconds: z.optional(positiveSafeIntegerSchema)
    })
    .readonly();

const microtestExecutionSchema = z.discriminatedUnion('processModel', [
    z
        .strictObject({
            processModel: z.literal('in-process'),
            scheduling: z.optional(z.union([ z.literal('concurrent'), z.literal('serial') ]))
        })
        .readonly(),
    z
        .strictObject({
            processModel: z.literal('supervised-process'),
            scheduling: z.optional(z.union([ z.literal('concurrent'), z.literal('serial') ]))
        })
        .readonly()
]);

const profileSchema = z.discriminatedUnion('testFamily', [
    z
        .strictObject({
            execution: z.optional(microtestExecutionSchema),
            reporters: z.optional(z.tuple([ reporterSchema ]).rest(reporterSchema).readonly()),
            resourceUsage: z.optional(resourceUsageSchema),
            testFamily: z.literal('microtest'),
            timeouts: z.optional(timeoutSchema)
        })
        .readonly()
]);

const profilesSchema = z.record(z.string(), profileSchema).readonly();

const projectConfigSchema = z
    .strictObject({
        loader: z.optional(loaderSchema),
        outputRenderer: z.optional(outputRendererSchema),
        profiles: z.optional(profilesSchema),
        reporters: z.optional(z.tuple([ reporterSchema ]).rest(reporterSchema).readonly()),
        runtimeStateDir: z.optional(z.string().min(1))
    })
    .readonly();

export type RunProjectResourceBudgets = z.infer<typeof resourceBudgetsSchema>;
export type RunProjectMeasuredResourceUsage = z.infer<typeof measuredResourceUsageSchema>;
export type RunProjectUnmeasuredResourceUsage = z.infer<typeof unmeasuredResourceUsageSchema>;
export type RunProjectResourceUsageConfig = z.infer<typeof resourceUsageSchema>;
export type RunProjectTimeoutConfig = z.infer<typeof timeoutSchema>;
export type RunProjectMicrotestExecution = z.infer<typeof microtestExecutionSchema>;
export type RunProjectMicrotestProfileConfig = z.infer<typeof profileSchema>;
export type RunProjectProfilesConfig = z.infer<typeof profilesSchema>;
export type RunProjectConfig = z.infer<typeof projectConfigSchema>;

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

function normalizeTimeouts(timeouts: RunProjectTimeoutConfig | undefined): RunTimeoutPolicy {
    return {
        hardMilliseconds: timeouts?.hardMilliseconds ?? defaultTimeoutPolicy.hardMilliseconds,
        softMilliseconds: timeouts?.softMilliseconds ?? defaultTimeoutPolicy.softMilliseconds
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
    const normalizedProfiles: Record<string, RunMicrotestProfileConfig> = {};
    const profileEntries = Object.entries(profiles ?? {});

    for (const [ profileName, profile ] of profileEntries) {
        assertValidProfileName(profileName);
        normalizedProfiles[profileName] = normalizeMicrotestProfile(profile);
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
