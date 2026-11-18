import {
    createCommandLineRoutes,
    type CommandLineCommandLoaders,
    type CommandLineCommandNamespace,
    type CommandLineNamespaceRuntime
} from './command-line-command-namespace.ts';

const nativeCommandLineRuntime: CommandLineNamespaceRuntime = {
    async history(loadConfig) {
        const { createHistoryCommands } = await import('./history-commands.ts');
        return createHistoryCommands(loadConfig);
    },
    async corpus() {
        const { corpusCommands } = await import('./corpus-commands.ts');
        return corpusCommands;
    },
    async merge(loadConfig, request) {
        const { mergeResultsCommand } = await import('./merge-results-command.ts');
        return await mergeResultsCommand(loadConfig, request);
    },
    async replay(loaders, context) {
        const { createReplayCommand, replayTerminal } = await import('./replay-command.ts');
        const commands = await loaders.loadReplayCommands();
        return await createReplayCommand({
            loadConfig: loaders.loadConfig,
            isTerminal: replayTerminal.isTerminal,
            pickRun: replayTerminal.pickRun,
            replayRecordedRun: commands.replayRun
        })(context);
    }
};

export function createCommandLineCommandNamespace(loaders: CommandLineCommandLoaders): CommandLineCommandNamespace {
    return createCommandLineRoutes(loaders, nativeCommandLineRuntime);
}
