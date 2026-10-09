import type { ConfigLoader } from '../config/config.ts';
import type { NormalizedConfig } from '../config/types.ts';
import {
    createCommandLineErrorResultFromUnknown,
    type CommandLineBenchmarkCommands
} from './command-line-command.ts';
import { createUnimplementedBaselineCommands } from './command-line-unimplemented-commands.ts';
import { invalidRequest } from './run-errors.ts';
import type { RunOrchestrator } from './run-types.ts';
import type { CommandLineConfigDependencies } from './command-line-config.ts';
import {
    listTestsWithLoadedConfig,
    runTestsWithLoadedConfig,
    type CommandLineExecutionDependencies
} from './command-line-execution.ts';
import { createSystemRunTimingMeasurement, emptyTimingSpanMetadata } from './run-timing-collection.ts';

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

export type BenchmarkCommandDependencies = CommandLineConfigDependencies & {
    readonly loadConfig: ConfigLoader;
    readonly orchestrator: RunOrchestrator;
};

export function createBenchmarkCommands(dependencies: BenchmarkCommandDependencies): CommandLineBenchmarkCommands {
    const execution: CommandLineExecutionDependencies = {
        createDefaultReporter: dependencies.createDefaultReporter,
        orchestrator: {
            resolve: dependencies.orchestrator.bench.list,
            runWithReporterDelivery: dependencies.orchestrator.bench.runWithReporterDelivery
        }
    };

    return {
        baseline: createUnimplementedBaselineCommands('bench baseline'),
        async listBenchmarks(request) {
            try {
                const config = await dependencies.loadConfig(request);
                const profile = selectBenchmarkProfile(request.listRequest.profile, config);

                return await listTestsWithLoadedConfig(
                    {
                        ...request,
                        listRequest: { ...request.listRequest, profile }
                    },
                    execution,
                    config
                );
            } catch (error: unknown) {
                return createCommandLineErrorResultFromUnknown(error);
            }
        },
        async runBenchmarks(request) {
            const timing = createSystemRunTimingMeasurement();

            try {
                const config = await timing.measureAsync(
                    'config.load',
                    emptyTimingSpanMetadata(),
                    async function loadBenchmarkConfig() {
                        return await dependencies.loadConfig(request);
                    }
                );
                const profile = selectBenchmarkProfile(request.runRequest.profile, config);

                return await runTestsWithLoadedConfig(
                    {
                        ...request,
                        runRequest: { ...request.runRequest, profile }
                    },
                    execution,
                    config,
                    { timing }
                );
            } catch (error: unknown) {
                return createCommandLineErrorResultFromUnknown(error);
            }
        }
    };
}
