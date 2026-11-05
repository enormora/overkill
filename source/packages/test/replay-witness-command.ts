import { command, option, positional, string } from 'cmd-ts';
import type { CommandLineRunner, CommandLineRunnerResult } from '../run/command-line.entry-point.ts';
import { configPathArgument } from './command-line-config-path.ts';

const replayArguments = {
    configPath: configPathArgument,
    profile: option({ long: 'profile', type: string }),
    path: positional({ type: string })
};
type ReplayWitnessArguments = { readonly configPath: string | null; readonly profile: string; readonly path: string; };
type ReplayWitnessParser = ReturnType<
    typeof command<typeof replayArguments, (args: ReplayWitnessArguments) => Promise<CommandLineRunnerResult>>
>;
export function createReplayWitnessCommand(
    loadRunner: () => Promise<CommandLineRunner>,
    cwd: string
): ReplayWitnessParser {
    return command({
        name: 'replay-witness',
        args: replayArguments,
        async handler(args) {
            const runner = await loadRunner();
            return await runner.replayWitness({
                cwd,
                configPath: args.configPath ?? null,
                arguments: [ args.path, args.profile ]
            });
        }
    });
}
