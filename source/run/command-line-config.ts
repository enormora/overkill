import type { DefinedReporter } from '../engine/reporter.ts';
import type { NormalizedConfig, ProfileConfig } from '../config/types.ts';
import type { LoadedConfig } from '../config/config.ts';
import type { CommandLineRunTestsRequest } from './command-line-command.ts';
import { selectProfile } from './test-profile.ts';
import { selectCommandLineReporterFallback, type CommandLineReporterFallback } from './run-reporter-resolution.ts';

export type CommandLineConfigDependencies = { readonly createDefaultReporter: () => Promise<DefinedReporter>; };

async function loadCommandLineReporterFallback(
    fallback: CommandLineReporterFallback,
    dependencies: CommandLineConfigDependencies
): Promise<readonly DefinedReporter[]> {
    if (fallback.kind === 'configured') {
        return fallback.reporters;
    }

    if (fallback.kind === 'default') {
        return [ await dependencies.createDefaultReporter() ];
    }

    return [];
}

export async function createCommandLineConfig(
    loadedConfig: LoadedConfig,
    request: CommandLineRunTestsRequest,
    dependencies: CommandLineConfigDependencies
): Promise<NormalizedConfig> {
    const reporterFallback = selectCommandLineReporterFallback(loadedConfig, request.runRequest.profile);

    return {
        loader: loadedConfig.loader,
        outputRenderer: loadedConfig.outputRenderer,
        profiles: loadedConfig.profiles,
        reporters: await loadCommandLineReporterFallback(reporterFallback, dependencies),
        runtimeStateDir: loadedConfig.runtimeStateDir
    };
}

function listProfile(profile: ProfileConfig): ProfileConfig {
    if (profile.testFamily !== 'microtest') {
        return profile;
    }

    return {
        ...profile,
        execution: {
            maxConcurrency: profile.execution.maxConcurrency,
            processModel: 'in-process',
            scheduling: profile.execution.scheduling
        }
    };
}

function listProfiles(profiles: NormalizedConfig['profiles']): NormalizedConfig['profiles'] {
    return Object.fromEntries(
        Object.entries(profiles).map(function toListProfile(entry) {
            const [ name, profile ] = entry;

            return [ name, listProfile(profile) ];
        })
    );
}

export function createCommandLineListConfig(loadedConfig: LoadedConfig, profileName: string): NormalizedConfig {
    selectProfile(profileName, loadedConfig);
    return {
        loader: loadedConfig.loader,
        outputRenderer: loadedConfig.outputRenderer,
        profiles: listProfiles(loadedConfig.profiles),
        reporters: [],
        runtimeStateDir: loadedConfig.runtimeStateDir
    };
}
