import {
    RunResolutionError,
    type MicrotestProfileConfig,
    type NormalizedConfig
} from '../run/run.entry-point.ts';

export type SelectedMicrotestProfile = {
    readonly name: string;
    readonly profile: MicrotestProfileConfig;
};

function namedMicrotestProfile(config: NormalizedConfig, name: string): SelectedMicrotestProfile {
    const profile = Object.hasOwn(config.profiles, name) ? config.profiles[name] : undefined;

    if (profile === undefined) {
        throw new RunResolutionError(`Unknown mutation profile: "${name}".`, undefined, 'invalid-request');
    }

    if (profile.testFamily !== 'microtest') {
        throw new RunResolutionError(
            `Profile "${name}" has testFamily "${profile.testFamily}". Stryker requires a Node microtest profile.`,
            undefined,
            'invalid-request'
        );
    }

    return { name, profile };
}

function inferMicrotestProfile(config: NormalizedConfig): SelectedMicrotestProfile {
    const eligible = Object.entries(config.profiles).flatMap(function microtestEntry([ profileName, profile ]) {
        return profile.testFamily === 'microtest' ? [ { name: profileName, profile } ] : [];
    });
    const [ selected ] = eligible;

    if (selected === undefined) {
        throw new RunResolutionError('No eligible Node microtest profiles exist.', undefined, 'invalid-request');
    }

    if (eligible.length > 1) {
        const names = eligible
            .map(function profileName(profile) {
                return profile.name;
            })
            .toSorted(function compareProfileNames(first, second) {
                return first.localeCompare(second);
            });

        throw new RunResolutionError(
            `Multiple microtest profiles exist: ${names.join(', ')}. Set overkill.profile to one name.`,
            undefined,
            'invalid-request'
        );
    }

    return selected;
}

export function selectMicrotestProfile(config: NormalizedConfig, name: string | null): SelectedMicrotestProfile {
    return name === null ? inferMicrotestProfile(config) : namedMicrotestProfile(config, name);
}
