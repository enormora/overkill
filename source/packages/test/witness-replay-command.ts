import { command, flag, multioption, option, positional, string, type Type } from 'cmd-ts';
import type { CommandLineRunner } from '../run/command-line.entry-point.ts';
import { parseDebugRequest } from '../../run/run-debug.ts';
import { profileSelectionType } from './command-line-selection.ts';
import { runExecutionArguments } from './run-command-arguments.ts';

type ReplaySeed = { readonly value: bigint | null; };
type ReplayParsers = {
    readonly config: Type<readonly string[], string | null>;
    readonly seed: Type<string, ReplaySeed>;
};
type ReplayArguments = {
    readonly debug: typeof runExecutionArguments.debug;
    readonly debugScope: typeof runExecutionArguments.debugScope;
    readonly configPath: ReturnType<typeof multioption<ReplayParsers['config']>>;
    readonly path: ReturnType<typeof positional<typeof string>>;
    readonly profile: ReturnType<typeof multioption<typeof profileSelectionType>>;
    readonly seed: ReturnType<typeof option<ReplayParsers['seed']>>;
    readonly record: ReturnType<typeof flag>;
    readonly noCapture: ReturnType<typeof flag>;
    readonly timings: ReturnType<typeof flag>;
};
type ReplayValues = {
    readonly debug: boolean;
    readonly debugScope: readonly string[];
    readonly configPath: string | null;
    readonly path: string;
    readonly profile: string | null;
    readonly seed: ReplaySeed;
    readonly record: boolean;
    readonly noCapture: boolean;
    readonly timings: boolean;
};
type ReplayHandler = (args: ReplayValues) => ReturnType<CommandLineRunner['replayWitness']>;
export function createWitnessReplayCommand(
    loadRunner: () => Promise<CommandLineRunner>,
    cwd: string,
    parsers: ReplayParsers
): ReturnType<typeof command<ReplayArguments, ReplayHandler>> {
    return command({
        name: 'replay-witness',
        args: {
            debug: runExecutionArguments.debug,
            debugScope: runExecutionArguments.debugScope,
            configPath: multioption({
                long: 'config',
                type: parsers.config,
                defaultValue() {
                    return null;
                }
            }),
            path: positional({ type: string, displayName: 'path' }),
            profile: multioption({ long: 'profile', type: profileSelectionType }),
            seed: option({
                long: 'seed',
                type: parsers.seed,
                defaultValue() {
                    return { value: null };
                }
            }),
            record: flag({ long: 'record' }),
            noCapture: flag({ long: 'no-capture' }),
            timings: flag({ long: 'timings' })
        },
        async handler(args) {
            const debug = parseDebugRequest(args.debug, args.debugScope);
            const runner = await loadRunner();
            return await runner.replayWitness({
                cwd,
                configPath: args.configPath,
                replayRequest: {
                    debug,
                    path: args.path,
                    profile: args.profile,
                    seed: args.seed,
                    capture: args.noCapture ? 'live' : 'buffered',
                    record: args.record,
                    timingCollection: args.timings ? 'precise' : 'profile-default'
                }
            });
        }
    });
}
