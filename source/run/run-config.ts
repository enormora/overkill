import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from '@schema-hub/zod-error-formatter';
import { z } from 'zod/v4';
import type { NonEmptyReadonlyArray } from '../assertion-protocol/assertion-node-shape.ts';
import type { Reporter } from '../engine/reporter.ts';
import type { RunLoaderConfig } from './run.ts';

const defaultConfigFileNames = [ 'overkill.config.ts', 'overkill.config.js' ];

export type RunProjectConfig = {
    readonly loader?: RunLoaderConfig;
    readonly reporters?: NonEmptyReadonlyArray<Reporter>;
    readonly runtimeStateDir?: string;
};

export type LoadedRunConfig = {
    readonly configPath: string | null;
    readonly loader: RunLoaderConfig;
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

const reporterSchema = z.custom<Reporter>(function isReporter(value) {
    return typeof value === 'object' && value !== null &&
        Object.hasOwn(value, 'kind') &&
        Object.hasOwn(value, 'name') &&
        Object.hasOwn(value, 'sinks');
});

const loaderSchema = z.strictObject({
    sourceMaps: z.boolean(),
    stripMode: z.union([ z.literal('strip-only'), z.literal('transform') ])
});

const projectConfigSchema = z.strictObject({
    loader: z.optional(loaderSchema),
    reporters: z.optional(z.array(reporterSchema).min(1)),
    runtimeStateDir: z.optional(z.string().min(1))
});

type ParsedProjectConfig = {
    readonly loader?: RunLoaderConfig | undefined;
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

function normalizeConfig(parsedConfig: ParsedProjectConfig, configPath: string | null): LoadedRunConfig {
    return {
        configPath,
        loader: parsedConfig.loader ?? defaultLoader,
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
