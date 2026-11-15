import { readCalibrationReferenceReport } from '../bench/calibration-report.ts';
import { snapshotRunCommand } from './frozen-run-command.ts';
import {
    createCommandLineErrorResultFromUnknown,
    type CommandLineBenchmarkCommands,
    type CommandLineBenchmarkRunRequest,
    type CommandLineRunnerResult,
    type CommandLineBenchmarkBaselineRequest
} from './command-line-command.ts';
import { selectBenchmarkCommandProfile, type BenchmarkCommandDependencies } from './benchmark-command-policy.ts';
import {
    listTestsWithLoadedConfig,
    runTestsWithLoadedConfig,
    type CommandLineExecutionDependencies
} from './command-line-execution.ts';
import {
    createSystemRunTimingMeasurement,
    emptyTimingSpanMetadata,
    type RunTimingMeasurement
} from './run-timing-collection.ts';

async function executeCalibration(
    dependencies: BenchmarkCommandDependencies,
    request: CommandLineBenchmarkRunRequest,
    execution: CommandLineExecutionDependencies,
    timing: RunTimingMeasurement
): Promise<CommandLineRunnerResult> {
    const loaded = await dependencies.loadConfig(request);
    const profile = selectBenchmarkCommandProfile(request.runRequest.profile, loaded);
    const result = await runTestsWithLoadedConfig(
        { ...request, runRequest: { ...request.runRequest, profile } },
        {
            ...execution,
            orchestrator: {
                ...execution.orchestrator,
                async runWithReporterDelivery(command, options) {
                    return await dependencies.orchestrator.bench.calibrate(
                        snapshotRunCommand(command).command,
                        options
                    );
                }
            }
        },
        loaded,
        { timing }
    );
    const report = result.runResult === null ? null : readCalibrationReferenceReport(result.runResult);
    return {
        ...result,
        stdoutLines: report?.completed.map(function capturedReference(file) {
            return `Captured calibration reference ${file}`;
        }) ?? []
    };
}
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
            async resolve(command, options) {
                return await dependencies.orchestrator.bench.list(snapshotRunCommand(command).command, options);
            },
            async runWithReporterDelivery(command, options) {
                return await dependencies.orchestrator.bench.runWithReporterDelivery(
                    snapshotRunCommand(command).command,
                    options
                );
            }
        }
    };

    return {
        async calibrate(request) {
            const timing = createSystemRunTimingMeasurement();
            try {
                return await executeCalibration(dependencies, request, execution, timing);
            } catch (error: unknown) {
                return createCommandLineErrorResultFromUnknown(error);
            }
        },
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
