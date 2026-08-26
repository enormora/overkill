import type { LoadedRunConfig } from './run-config.ts';

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
