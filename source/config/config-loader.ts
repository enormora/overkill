import path from 'node:path';
import type { NormalizedConfig, ConfigLoadRequest as ConfigLoaderRequest } from './types.ts';
import { defaultConfigFileNames } from './defaults.ts';
import { ConfigError } from './config-error.ts';
import { normalizeConfigFromOrigin } from './config.ts';

export type LoadedConfig = NormalizedConfig & { readonly configPath: string | null; };
export type ConfigLoadRequest = ConfigLoaderRequest;

export type ConfigLoaderDependencies = {
    readonly fileExists: (filePath: string) => Promise<boolean>;
    readonly importModule: (configPath: string) => Promise<unknown>;
};

export type ConfigLoader = (request: ConfigLoadRequest) => Promise<LoadedConfig>;

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

export function createConfigLoader(dependencies: ConfigLoaderDependencies): ConfigLoader {
    return async function loadConfig(request) {
        const configPath = await resolveConfigPath(request, dependencies);

        if (configPath === null) {
            return { ...normalizeConfigFromOrigin({}, null), configPath: null };
        }

        const configModule = await importConfigModule(configPath, dependencies);
        const configValue = readNamedConfigExport(configModule, configPath);

        return { ...normalizeConfigFromOrigin(configValue, configPath), configPath };
    };
}
