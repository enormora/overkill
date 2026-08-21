import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from '@schema-hub/zod-error-formatter';
import { z } from 'zod/v4';
import type { NonEmptyReadonlyArray } from '../assertion-protocol/assertion-node-shape.ts';
import { createPlainOutputRenderer, type OutputRenderer } from '../engine/reporter-output.ts';
import type { Reporter } from '../engine/reporter.ts';
import type {
    RunLoaderConfig,
    RunMicrotestExecution,
    RunMicrotestProfileConfig,
    RunProfilesConfig,
    RunResourceBudgets,
    RunResourceUsagePolicy,
    RunTimeoutPolicy
} from './run-types.ts';

const defaultConfigFileNames = [ 'overkill.config.ts', 'overkill.config.js' ];
const defaultResourceUsageSamplingIntervalMilliseconds = 100;
const defaultMicrotestHardTimeoutMilliseconds = 1000;
const defaultMicrotestTimeoutMilliseconds = 500;

export type RunProjectConfig = {
    readonly loader?: RunLoaderConfig | undefined;
    readonly outputRenderer?: OutputRenderer | undefined;
    readonly profiles?: RunProjectProfilesConfig | undefined;
    readonly reporters?: NonEmptyReadonlyArray<Reporter> | undefined;
    readonly runtimeStateDir?: string | undefined;
};

export type LoadedRunConfig = {
    readonly configPath: string | null;
    readonly loader: RunLoaderConfig;
    readonly outputRenderer: OutputRenderer;
    readonly profiles: RunProfilesConfig;
    readonly reporters: NonEmptyReadonlyArray<Reporter> | null;
    readonly runtimeStateDir: string;
};

export type RunProjectResourceBudgets = {
    readonly activeResourceCount?: number | null | undefined;
    readonly javaScriptEngineHeapBytes?: number | null | undefined;
    readonly residentSetBytes?: number | null | undefined;
    readonly residentSetGrowthBytesPerSecond?: number | null | undefined;
};

export type RunProjectMeasuredResourceUsage = {
    readonly budgets?: RunProjectResourceBudgets | undefined;
    readonly measure: true;
    readonly samplingIntervalMilliseconds?: number | undefined;
};

export type RunProjectUnmeasuredResourceUsage = {
    readonly budgets?: never;
    readonly measure?: false | undefined;
    readonly samplingIntervalMilliseconds?: never;
};

export type RunProjectResourceUsageConfig = RunProjectMeasuredResourceUsage | RunProjectUnmeasuredResourceUsage;

export type RunProjectTimeoutConfig = {
    readonly hardMilliseconds?: number | undefined;
    readonly softMilliseconds?: number | undefined;
};

export type RunProjectMicrotestExecution = {
    readonly processModel: 'in-process';
    readonly scheduling?: 'concurrent' | 'serial' | undefined;
} | {
    readonly processModel: 'supervised-process';
    readonly scheduling?: 'concurrent' | 'serial' | undefined;
};

export type RunProjectMicrotestProfileConfig = {
    readonly execution?: RunProjectMicrotestExecution | undefined;
    readonly reporters?: NonEmptyReadonlyArray<Reporter> | undefined;
    readonly resourceUsage?: RunProjectResourceUsageConfig | undefined;
    readonly testFamily: 'microtest';
    readonly timeouts?: RunProjectTimeoutConfig | undefined;
};

export type RunProjectProfilesConfig = Readonly<Record<string, RunProjectMicrotestProfileConfig>>;

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

const reporterSchema = z.custom<Reporter>(function isReporter(value) {
    return typeof value === 'object' && value !== null &&
        Object.hasOwn(value, 'kind') &&
        Object.hasOwn(value, 'name') &&
        Object.hasOwn(value, 'sinks');
});

type PossibleOutputRenderer = {
    readonly render: unknown;
};

function hasRenderProperty(value: unknown): value is PossibleOutputRenderer {
    return typeof value === 'object' && value !== null && Object.hasOwn(value, 'render');
}

const outputRendererSchema = z.custom<OutputRenderer>(function isOutputRenderer(value) {
    return hasRenderProperty(value) && typeof value.render === 'function';
});

const loaderSchema = z.strictObject({
    sourceMaps: z.boolean(),
    stripMode: z.literal('strip-only')
});

const positiveSafeIntegerSchema = z.number().refine(function isPositiveSafeInteger(value) {
    return Number.isSafeInteger(value) && value > 0;
}, 'must be a positive safe integer');

const resourceBudgetsSchema = z.strictObject({
    activeResourceCount: z.optional(z.nullable(positiveSafeIntegerSchema)),
    javaScriptEngineHeapBytes: z.optional(z.nullable(positiveSafeIntegerSchema)),
    residentSetBytes: z.optional(z.nullable(positiveSafeIntegerSchema)),
    residentSetGrowthBytesPerSecond: z.optional(z.nullable(positiveSafeIntegerSchema))
});

const measuredResourceUsageSchema = z.strictObject({
    budgets: z.optional(resourceBudgetsSchema),
    measure: z.literal(true),
    samplingIntervalMilliseconds: z.optional(positiveSafeIntegerSchema)
});

const unmeasuredResourceUsageSchema = z.strictObject({
    measure: z.optional(z.literal(false))
});

const resourceUsageSchema = z.union([ measuredResourceUsageSchema, unmeasuredResourceUsageSchema ]);

const timeoutSchema = z.strictObject({
    hardMilliseconds: z.optional(positiveSafeIntegerSchema),
    softMilliseconds: z.optional(positiveSafeIntegerSchema)
});

const microtestExecutionSchema = z.discriminatedUnion('processModel', [
    z.strictObject({
        processModel: z.literal('in-process'),
        scheduling: z.optional(z.union([ z.literal('concurrent'), z.literal('serial') ]))
    }),
    z.strictObject({
        processModel: z.literal('supervised-process'),
        scheduling: z.optional(z.union([ z.literal('concurrent'), z.literal('serial') ]))
    })
]);

const profileSchema = z.discriminatedUnion('testFamily', [
    z.strictObject({
        execution: z.optional(microtestExecutionSchema),
        reporters: z.optional(z.tuple([ reporterSchema ]).rest(reporterSchema)),
        resourceUsage: z.optional(resourceUsageSchema),
        testFamily: z.literal('microtest'),
        timeouts: z.optional(timeoutSchema)
    })
]);

const profilesSchema = z.record(z.string(), profileSchema);

const projectConfigSchema = z.strictObject({
    loader: z.optional(loaderSchema),
    outputRenderer: z.optional(outputRendererSchema),
    profiles: z.optional(profilesSchema),
    reporters: z.optional(z.tuple([ reporterSchema ]).rest(reporterSchema)),
    runtimeStateDir: z.optional(z.string().min(1))
});

type ParsedProjectConfig = {
    readonly loader?: RunLoaderConfig | undefined;
    readonly outputRenderer?: OutputRenderer | undefined;
    readonly profiles?: RunProjectProfilesConfig | undefined;
    readonly reporters?: NonEmptyReadonlyArray<Reporter> | undefined;
    readonly runtimeStateDir?: string | undefined;
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

function hasDefaultExport(configModule: unknown): configModule is ConfigModuleWithDefaultExport {
    return typeof configModule === 'object' && configModule !== null && Object.hasOwn(configModule, 'default');
}

function readDefaultExport(configModule: unknown, configPath: string): unknown {
    if (hasDefaultExport(configModule)) {
        return configModule.default;
    }

    throw new RunConfigError(`Config file "${configPath}" must export a default config object.`);
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

function normalizeExecution(execution: RunProjectMicrotestExecution | undefined): RunMicrotestExecution {
    return {
        processModel: execution?.processModel ?? defaultMicrotestExecution.processModel,
        scheduling: execution?.scheduling ?? defaultMicrotestExecution.scheduling
    };
}

function normalizeMicrotestProfile(profile: RunProjectMicrotestProfileConfig): RunMicrotestProfileConfig {
    return {
        execution: normalizeExecution(profile.execution),
        reporters: normalizeReporters(profile.reporters),
        resourceUsage: normalizeResourceUsage(profile.resourceUsage),
        testFamily: 'microtest',
        timeouts: normalizeTimeouts(profile.timeouts)
    };
}

function assertValidProfileName(profileName: string): void {
    if (!/^[A-Za-z0-9._-]+$/u.test(profileName)) {
        const message = `Invalid profile name "${profileName}". ` +
            'Profile names may only contain letters, numbers, dots, underscores, and hyphens.';

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

function normalizeConfig(parsedConfig: ParsedProjectConfig, configPath: string | null): LoadedRunConfig {
    return {
        configPath,
        loader: parsedConfig.loader ?? defaultLoader,
        outputRenderer: parsedConfig.outputRenderer ?? createPlainOutputRenderer(),
        profiles: normalizeConfiguredProfiles(parsedConfig.profiles),
        reporters: normalizeReporters(parsedConfig.reporters),
        runtimeStateDir: parsedConfig.runtimeStateDir ?? '.overkill'
    };
}

function parseConfig(configValue: unknown, configPath: string): ParsedProjectConfig {
    try {
        const parsedConfig: ParsedProjectConfig = parse(projectConfigSchema, configValue);

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
    const configValue = readDefaultExport(configModule, configPath);

    return normalizeConfig(parseConfig(configValue, configPath), configPath);
}
