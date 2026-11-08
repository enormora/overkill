import type { ConfigLoader } from '../config/config.ts';
import { baselineIdentityKey } from '../baselines/baseline-planning.ts';
import { ordinaryBaselineIdentity } from './baseline-record.ts';
import { createCommandLineConfig, type CommandLineConfigDependencies } from './command-line-config.ts';
import {
    createCommandLineErrorResultFromUnknown,
    commandLineExitCodes,
    formatRunnerErrorDiagnostics,
    readExitCodeFromRunResult,
    type CommandLineBaselineCommands,
    type CommandLineBaselineRequest,
    type CommandLineRunnerResult
} from './command-line-command.ts';
import type { BaselineRunResult } from './baseline-types.ts';
import type { RunOrchestrator } from './run-orchestrator-types.ts';
import { createSystemRunTimingMeasurement } from './run-timing-collection.ts';
import { selectBaselineProfile } from './test-profile.ts';

type BaselineDependencies = CommandLineConfigDependencies & {
    readonly loadConfig: ConfigLoader;
    readonly orchestrator: Pick<RunOrchestrator, 'baseline'>;
};
type ExecutingBaselineVerb = 'apply' | 'bootstrap' | 'diff' | 'update';
function baselineCommandResult(result: BaselineRunResult, mode: ExecutingBaselineVerb): CommandLineRunnerResult {
    const runExit = readExitCodeFromRunResult(result.result);
    return {
        exitCode: mode === 'diff' && runExit === commandLineExitCodes.pass && result.changes.length > 0
            ? commandLineExitCodes.testFailure
            : runExit,
        fallbackDiagnostics: formatRunnerErrorDiagnostics(result.undeliveredRunnerErrors),
        runResult: result.result,
        stdoutLines: [
            ...result.warnings,
            ...result.changes.map(function change(entry) {
                return `${entry.kind} ${baselineIdentityKey(ordinaryBaselineIdentity(entry.baseline))}`;
            })
        ]
    };
}
export function createBaselineCommands(dependencies: BaselineDependencies): CommandLineBaselineCommands {
    function verb(mode: 'apply' | 'bootstrap' | 'diff' | 'update') {
        return async function execute(request: CommandLineBaselineRequest) {
            try {
                const loaded = await dependencies.loadConfig(request);
                selectBaselineProfile(request.runRequest.profile, loaded);
                const config = await createCommandLineConfig(loaded, {
                    ...request,
                    runRequest: { ...request.runRequest, baselineUpdateMode: 'none' }
                }, dependencies);
                const result = await dependencies.orchestrator.baseline[mode]({
                    config,
                    cwd: request.cwd,
                    engine: { kind: 'default' },
                    request: request.runRequest
                }, { timing: createSystemRunTimingMeasurement() });
                return baselineCommandResult(result, mode);
            } catch (error: unknown) {
                return createCommandLineErrorResultFromUnknown(error);
            }
        };
    }
    return {
        apply: verb('apply'),
        bootstrap: verb('bootstrap'),
        diff: verb('diff'),
        update: verb('update'),
        async list(request) {
            try {
                const config = await dependencies.loadConfig(request);
                const entries = await dependencies.orchestrator.baseline.list({
                    config,
                    cwd: request.cwd,
                    request: request.listRequest
                });
                return {
                    exitCode: commandLineExitCodes.pass,
                    fallbackDiagnostics: [],
                    runResult: null,
                    stdoutLines: entries.map(function entry({ baseline, path }) {
                        return `${path}: ${baselineIdentityKey(ordinaryBaselineIdentity(baseline))}`;
                    })
                };
            } catch (error: unknown) {
                return createCommandLineErrorResultFromUnknown(error);
            }
        }
    };
}
