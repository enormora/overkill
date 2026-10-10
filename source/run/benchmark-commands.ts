import {
    createCommandLineErrorResultFromUnknown,
    type CommandLineBenchmarkCommands,
    type CommandLineBenchmarkBaselineRequest
} from './command-line-command.ts';
import { selectBenchmarkCommandProfile, type BenchmarkCommandDependencies } from './benchmark-command-policy.ts';
import {
    listTestsWithLoadedConfig,
    runTestsWithLoadedConfig,
    type CommandLineExecutionDependencies
} from './command-line-execution.ts';
import { createSystemRunTimingMeasurement, emptyTimingSpanMetadata } from './run-timing-collection.ts';

export function createBenchmarkCommands(dependencies: BenchmarkCommandDependencies): CommandLineBenchmarkCommands {
    function baselineVerb(verb: 'apply' | 'bootstrap' | 'diff' | 'update') {
        return async function runBaselineCommand(request: CommandLineBenchmarkBaselineRequest) {
            const { runBenchmarkBaselineCommand } = await import('./benchmark-baseline-commands.ts');
            return await runBenchmarkBaselineCommand({ dependencies, request, verb });
        };
    }
    const execution: CommandLineExecutionDependencies = {
        createDefaultReporter: dependencies.createDefaultReporter,
        orchestrator: {
            resolve: dependencies.orchestrator.bench.list,
            runWithReporterDelivery: dependencies.orchestrator.bench.runWithReporterDelivery
        }
    };

    return {
        baseline: {
            apply: baselineVerb('apply'),
            bootstrap: baselineVerb('bootstrap'),
            diff: baselineVerb('diff'),
            async list(request) {
                const { listBenchmarkBaselineCommand } = await import('./benchmark-baseline-commands.ts');
                return await listBenchmarkBaselineCommand({ dependencies, request });
            },
            update: baselineVerb('update')
        },
        async listBenchmarks(request) {
            try {
                const config = await dependencies.loadConfig(request);
                const profile = selectBenchmarkCommandProfile(request.listRequest.profile, config);

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
                const profile = selectBenchmarkCommandProfile(request.runRequest.profile, config);

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
