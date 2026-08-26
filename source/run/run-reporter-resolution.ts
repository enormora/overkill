import type { LoadedRunConfig } from './run-config.ts';
import { resolveRunReporters } from './run-support.ts';
import type { RunCommand } from './run-types.ts';

export type CommandLineReporterFallback = {
    readonly kind: 'configured';
    readonly reporters: NonNullable<LoadedRunConfig['reporters']>;
} | {
    readonly kind: 'default';
} | {
    readonly kind: 'none';
};

export function selectCommandLineReporterFallback(
    loadedConfig: LoadedRunConfig,
    profileName: string
): CommandLineReporterFallback {
    if (loadedConfig.reporters !== null) {
        return { kind: 'configured', reporters: loadedConfig.reporters };
    }

    const profile = loadedConfig.profiles[profileName];

    if (profile?.reporters !== null) {
        return { kind: 'none' };
    }

    return { kind: 'default' };
}

export function resolveCommandReporters(command: RunCommand): RunCommand['config']['reporters'] {
    const profile = command.config.profiles[command.request.profile];

    if (profile === undefined) {
        return command.config.reporters;
    }

    return resolveRunReporters(profile, command.config.reporters);
}
