import { command, flag, subcommands } from 'cmd-ts';
import type { Except } from 'type-fest';
import type { CommandLineRunner, CommandLineRunnerResult } from '../run/command-line.entry-point.ts';
import {
    sharedCommandArguments,
    runExecutionArguments,
    createRunTestsRequest,
    type RunCommandArguments
} from './run-command-arguments.ts';

const executionArguments = {
    ...sharedCommandArguments,
    coverage: flag({ long: 'coverage' }),
    ...runExecutionArguments
};
const listArguments = {
    configPath: sharedCommandArguments.configPath,
    paths: sharedCommandArguments.paths,
    profile: sharedCommandArguments.profile
};
type BaselineHandler = (
    args: Except<RunCommandArguments<string>, 'recordForMerge'>
) => Promise<CommandLineRunnerResult>;
type BaselineListHandler = (
    args: Pick<RunCommandArguments<string>, 'configPath' | 'paths' | 'profile'>
) => Promise<CommandLineRunnerResult>;
type BaselineExecutingCommand = ReturnType<typeof command<typeof executionArguments, BaselineHandler>>;
type BaselineListingCommand = ReturnType<typeof command<typeof listArguments, BaselineListHandler>>;
type ExecutingBaselineVerb = Exclude<keyof CommandLineRunner['baseline'], 'list'>;
type BaselineCommands = Readonly<Record<ExecutingBaselineVerb, BaselineExecutingCommand>> & {
    readonly list: BaselineListingCommand;
};
type BaselineParser = ReturnType<typeof subcommands<BaselineCommands>>;
export function createBaselineCommand(loadRunner: () => Promise<CommandLineRunner>, cwd: string): BaselineParser {
    function executingVerb(verb: ExecutingBaselineVerb): BaselineExecutingCommand {
        return command({
            name: verb,
            args: executionArguments,
            async handler(args) {
                const runner = await loadRunner();
                return await runner.baseline[verb](createRunTestsRequest({ ...args, recordForMerge: false }, cwd));
            }
        });
    }
    return subcommands({
        name: 'baseline',
        description: 'Inspect and reconcile ordinary baselines.',
        cmds: {
            apply: executingVerb('apply'),
            bootstrap: executingVerb('bootstrap'),
            diff: executingVerb('diff'),
            update: executingVerb('update'),
            list: command({
                name: 'list',
                args: listArguments,
                async handler(args) {
                    const runner = await loadRunner();
                    return await runner.baseline.list({
                        configPath: args.configPath,
                        cwd,
                        listRequest: { paths: args.paths, profile: args.profile }
                    });
                }
            })
        }
    });
}
