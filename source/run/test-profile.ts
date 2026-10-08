import type { NormalizedConfig, TestProfileConfig } from '../config/types.ts';
import { invalidRequest, RunResolutionError } from './run-errors.ts';

export function selectTestProfile(profileName: string, config: NormalizedConfig): TestProfileConfig {
    const profile = config.profiles[profileName];

    if (profile === undefined) {
        return invalidRequest(`Unknown run profile: ${profileName}`);
    }

    if (profile.testFamily === 'benchmark') {
        throw new RunResolutionError(
            `Profile "${profileName}" has testFamily "benchmark". Use "overkill bench run" or "overkill bench list".`,
            undefined,
            'unsupported-request'
        );
    }

    return profile;
}
