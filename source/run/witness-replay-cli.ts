import type { ConfigLoader } from '../config/config.ts';
import { preparePropertyReplay } from './property-replay-command.ts';
import { createCommandLineConfig, type CommandLineConfigDependencies } from './command-line-config.ts';
import {
    createCommandLineErrorResultFromUnknown,
    readExitCodeFromRunResult,
    formatRunnerErrorDiagnostics,
    type CommandLineRunnerResult
} from './command-line-command.ts';
import type { ConfiguredRunOrchestrator } from './run-types.ts';
import type { CommandLineWitnessReplayRequest } from './witness-replay-request.ts';

export type WitnessReplayHandler = (request: CommandLineWitnessReplayRequest) => Promise<CommandLineRunnerResult>;

type WitnessReplayDependencies = CommandLineConfigDependencies & {
    readonly loadConfig: ConfigLoader;
    readonly orchestrator: Pick<ConfiguredRunOrchestrator, 'runWithReporterDelivery'>;
};
export async function replayWitnessFromCommandLine(
    request: CommandLineWitnessReplayRequest,
    dependencies: WitnessReplayDependencies
): Promise<CommandLineRunnerResult> {
    try {
        const loaded = await dependencies.loadConfig(request);
        const prepared = await preparePropertyReplay({
            cwd: request.cwd,
            config: loaded,
            engine: { kind: 'default' },
            request: request.replayRequest
        });
        const config = await createCommandLineConfig(loaded, {
            cwd: request.cwd,
            configPath: request.configPath,
            runRequest: prepared.request
        }, dependencies);
        const { result, undeliveredRunnerErrors } = await dependencies.orchestrator.runWithReporterDelivery({
            ...prepared,
            config
        });
        return {
            exitCode: readExitCodeFromRunResult(result),
            runResult: result,
            stdoutLines: [],
            fallbackDiagnostics: formatRunnerErrorDiagnostics(undeliveredRunnerErrors)
        };
    } catch (error: unknown) {
        return createCommandLineErrorResultFromUnknown(error);
    }
}
