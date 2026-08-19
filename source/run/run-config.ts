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
    RunProfilesConfig,
    RunResourceBudgets,
    RunResourceUsagePolicy
} from './run.ts';

const defaultConfigFileNames = [ 'overkill.config.ts', 'overkill.config.js' ];
const defaultResourceUsageSamplingIntervalMilliseconds = 100;

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

export type RunProjectMeasuredMicrotestProfileConfig = {
    readonly measureResourceUsage: true;
    readonly resourceBudgets?: RunProjectResourceBudgets | undefined;
    readonly resourceUsageSamplingIntervalMilliseconds?: number | undefined;
};

export type RunProjectUnmeasuredMicrotestProfileConfig = {
    readonly measureResourceUsage?: false | undefined;
};

type RunProjectMicrotestProfileConfigVariants = readonly [
    RunProjectMeasuredMicrotestProfileConfig,
    RunProjectUnmeasuredMicrotestProfileConfig
];

export type RunProjectMicrotestProfileConfig = RunProjectMicrotestProfileConfigVariants[number];

export type RunProjectProfilesConfig = {
    readonly microtest?: RunProjectMicrotestProfileConfig | undefined;
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
    measureResourceUsage: false,
    resourceBudgets: {
        activeResourceCount: null,
        javaScriptEngineHeapBytes: null,
        residentSetBytes: null,
        residentSetGrowthBytesPerSecond: null
    },
    resourceUsageSamplingIntervalMilliseconds: defaultResourceUsageSamplingIntervalMilliseconds
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

const measuredMicrotestProfileSchema = z.strictObject({
    measureResourceUsage: z.literal(true),
    resourceBudgets: z.optional(resourceBudgetsSchema),
    resourceUsageSamplingIntervalMilliseconds: z.optional(positiveSafeIntegerSchema)
});

const unmeasuredMicrotestProfileSchema = z.strictObject({
    measureResourceUsage: z.optional(z.literal(false))
});

const microtestProfileSchema = z.union([ measuredMicrotestProfileSchema, unmeasuredMicrotestProfileSchema ]);

const profilesSchema = z.strictObject({
    microtest: z.optional(microtestProfileSchema)
});

const projectConfigSchema = z.strictObject({
    loader: z.optional(loaderSchema),
    outputRenderer: z.optional(outputRendererSchema),
    profiles: z.optional(profilesSchema),
    reporters: z.optional(z.array(reporterSchema).min(1)),
    runtimeStateDir: z.optional(z.string().min(1))
});

type ParsedProjectConfig = {
    readonly loader?: RunLoaderConfig | undefined;
    readonly outputRenderer?: OutputRenderer | undefined;
    readonly profiles?: RunProjectProfilesConfig | undefined;
    readonly reporters?: readonly Reporter[] | undefined;
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

function normalizeReporters(reporters: readonly Reporter[] | undefined): LoadedRunConfig['reporters'] {
    if (reporters === undefined) {
        return null;
    }

    const [ firstReporter, ...remainingReporters ] = reporters;

    if (firstReporter === undefined) {
        throw new RunConfigError('Config reporters must not be empty.');
    }

    return [ firstReporter, ...remainingReporters ];
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

function normalizeMicrotestProfile(
    profile: RunProjectMicrotestProfileConfig | undefined
): RunResourceUsagePolicy {
    if (profile?.measureResourceUsage !== true) {
        return defaultResourceUsagePolicy;
    }

    return {
        measureResourceUsage: true,
        resourceBudgets: normalizeResourceBudgets(profile.resourceBudgets),
        resourceUsageSamplingIntervalMilliseconds: profile.resourceUsageSamplingIntervalMilliseconds ??
            defaultResourceUsageSamplingIntervalMilliseconds
    };
}

function normalizeProfiles(profiles: RunProjectProfilesConfig | undefined): RunProfilesConfig {
    return {
        microtest: normalizeMicrotestProfile(profiles?.microtest)
    };
}

function normalizeConfig(parsedConfig: ParsedProjectConfig, configPath: string | null): LoadedRunConfig {
    return {
        configPath,
        loader: parsedConfig.loader ?? defaultLoader,
        outputRenderer: parsedConfig.outputRenderer ?? createPlainOutputRenderer(),
        profiles: normalizeProfiles(parsedConfig.profiles),
        reporters: normalizeReporters(parsedConfig.reporters),
        runtimeStateDir: parsedConfig.runtimeStateDir ?? '.overkill'
    };
}

function parseConfig(configValue: unknown, configPath: string): ParsedProjectConfig {
    try {
        const parsedConfig: ParsedProjectConfig = parse(projectConfigSchema, configValue);

        return parsedConfig;
    } catch (error: unknown) {
        if (error instanceof Error) {
            throw new RunConfigError(`Invalid config file "${configPath}": ${error.message}`, { cause: error });
        }

        throw error;
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
