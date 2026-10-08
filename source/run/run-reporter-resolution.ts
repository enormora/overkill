import type { LoadedConfig } from '../config/config.ts';
import { selectTestProfile } from './test-profile.ts';

export type CommandLineReporterFallback = {
    readonly kind: 'configured';
    readonly reporters: NonNullable<LoadedConfig['reporters']>;
} | {
    readonly kind: 'default';
} | {
    readonly kind: 'none';
};

export function selectCommandLineReporterFallback(
    loadedConfig: LoadedConfig,
    profileName: string
): CommandLineReporterFallback {
    const profile = loadedConfig.profiles[profileName] === undefined
        ? undefined
        : selectTestProfile(profileName, loadedConfig);

    if (loadedConfig.reporters !== null) {
        return { kind: 'configured', reporters: loadedConfig.reporters };
    }

    if (profile?.reporters !== null) {
        return { kind: 'none' };
    }

    return { kind: 'default' };
}
