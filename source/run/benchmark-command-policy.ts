import type { ConfigLoader } from '../config/config.ts';
import type { NormalizedConfig } from '../config/types.ts';
import { invalidRequest } from './run-errors.ts';
import type { RunOrchestrator } from './run-types.ts';
import type { CommandLineConfigDependencies } from './command-line-config.ts';

function inferBenchmarkProfile(config: NormalizedConfig): string {
    const names = Object
        .entries(config.profiles)
        .filter(function isBenchmarkProfile([ , profile ]) {
            return profile.testFamily === 'benchmark';
        })
        .map(function profileName([ name ]) {
            return name;
        })
        .toSorted(function compareProfileNames(first, second) {
            return first.localeCompare(second);
        });
    const [ name ] = names;

    if (name === undefined) {
        return invalidRequest('No benchmark profiles are configured. Configure a benchmark profile and use --profile.');
    }

    if (names.length > 1) {
        return invalidRequest(`Multiple benchmark profiles are configured: ${names.join(', ')}. Use --profile <name>.`);
    }

    return name;
}

export function selectBenchmarkCommandProfile(name: string | null, config: NormalizedConfig): string {
    if (name === null) {
        return inferBenchmarkProfile(config);
    }

    const profile = Object.hasOwn(config.profiles, name) ? config.profiles[name] : undefined;

    if (profile === undefined) {
        return invalidRequest(`Unknown benchmark profile: "${name}".`);
    }

    const { testFamily } = profile;

    if (testFamily !== 'benchmark') {
        return invalidRequest(
            `Profile "${name}" has testFamily "${testFamily}". Benchmark commands require testFamily "benchmark".`
        );
    }

    return name;
}

export type BenchmarkCommandDependencies = CommandLineConfigDependencies & {
    readonly loadConfig: ConfigLoader;
    readonly orchestrator: RunOrchestrator;
};
