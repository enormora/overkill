import type { BenchmarkProfileConfig, NormalizedConfig, ProfileConfig, TestProfileConfig } from '../config/types.ts';
import { invalidRequest, RunResolutionError } from './run-errors.ts';

export function selectProfile(profileName: string, config: NormalizedConfig): ProfileConfig {
    const profile = Object.hasOwn(config.profiles, profileName) ? config.profiles[profileName] : undefined;

    return profile ?? invalidRequest(`Unknown run profile: ${profileName}`);
}

export function selectTestProfile(profileName: string, config: NormalizedConfig): TestProfileConfig {
    const profile = selectProfile(profileName, config);

    if (profile.testFamily === 'benchmark') {
        throw new RunResolutionError(
            `Profile "${profileName}" has testFamily "benchmark". Use "overkill bench run" or "overkill bench list".`,
            undefined,
            'unsupported-request'
        );
    }

    return profile;
}

export function selectBenchmarkProfile(profileName: string, config: NormalizedConfig): BenchmarkProfileConfig {
    const profile = selectProfile(profileName, config);

    if (profile.testFamily !== 'benchmark') {
        const requirement = 'Benchmark commands require testFamily "benchmark".';
        return invalidRequest(`Profile "${profileName}" has testFamily "${profile.testFamily}". ${requirement}`);
    }

    return profile;
}
