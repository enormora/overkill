import type { ConfigLoader } from '../config/config.ts';
import type { NormalizedConfig } from '../config/types.ts';
import {
    createCommandLineErrorResultFromUnknown,
    type CommandLineBenchmarkCommand,
    type CommandLineBenchmarkCommands
} from './command-line-command.ts';
import { createUnimplementedBaselineCommands } from './command-line-unimplemented-commands.ts';
import { invalidRequest, RunResolutionError } from './run-errors.ts';

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

function selectBenchmarkProfile(name: string | null, config: NormalizedConfig): string {
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

function createBenchmarkCommand(command: string, loadConfig: ConfigLoader): CommandLineBenchmarkCommand {
    return async function selectBenchmarkCommand(request) {
        try {
            const config = await loadConfig({ configPath: request.configPath, cwd: request.cwd });
            const profile = selectBenchmarkProfile(request.profile, config);

            throw new RunResolutionError(
                `Command "${command}" for profile "${profile}" is not implemented yet.`,
                undefined,
                'unsupported-request'
            );
        } catch (error: unknown) {
            return createCommandLineErrorResultFromUnknown(error);
        }
    };
}

export function createBenchmarkCommands(loadConfig: ConfigLoader): CommandLineBenchmarkCommands {
    return {
        baseline: createUnimplementedBaselineCommands('bench baseline'),
        listBenchmarks: createBenchmarkCommand('bench list', loadConfig),
        runBenchmarks: createBenchmarkCommand('bench run', loadConfig)
    };
}
