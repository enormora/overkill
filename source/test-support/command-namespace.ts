import {
    createCommandLineRoutes,
    type CommandLineCommandLoaders,
    type CommandLineCommandNamespace,
    type CommandLineNamespaceRuntime
} from '../run/command-line-command-namespace.ts';
import type { CommandLineRunnerResult } from '../run/command-line-command.ts';
import type { ReplayCommands } from '../run/replay-commands.ts';

type NamespaceCall = { readonly verb: string; readonly request: unknown; };
type CommandNamespaceFixture = {
    readonly commands: CommandLineCommandNamespace;
    readonly calls: readonly NamespaceCall[];
    readonly loads: readonly string[];
};
export function commandNamespace(failure: Error | null): CommandNamespaceFixture {
    const calls: NamespaceCall[] = [];
    const loads: string[] = [];
    function command(verb: string): (request: unknown) => Promise<CommandLineRunnerResult> {
        return async function (request) {
            calls.push({ verb, request });
            if (failure !== null) {
                throw failure;
            }
            return { exitCode: 0, runResult: null, stdoutLines: [ verb ], fallbackDiagnostics: [] };
        };
    }
    const replay: ReplayCommands = { replayRun: command('recorded'), replayWitness: command('witness') };
    const baseline = {
        apply: command('apply'),
        bootstrap: command('bootstrap'),
        diff: command('diff'),
        list: command('list'),
        update: command('update')
    };
    const loaders: CommandLineCommandLoaders = {
        async loadConfig() {
            throw new Error('Routes must delegate configuration loading.');
        },
        async loadReplayCommands() {
            loads.push('replay');
            return replay;
        },
        async loadBaselineCommands() {
            loads.push('baseline');
            return baseline;
        },
        async loadBenchmarkCommands() {
            loads.push('benchmark');
            return {
                baseline,
                calibrate: command('calibrate'),
                listBenchmarks: command('bench.list'),
                runBenchmarks: command('bench.run')
            };
        }
    };
    const runtime: CommandLineNamespaceRuntime = {
        async history(load) {
            if (load !== loaders.loadConfig) {
                throw new Error('Wrong config loader.');
            }
            loads.push('history');
            return {
                list: command('history.list'),
                prune: command('history.prune'),
                compact: command('history.compact'),
                clear: command('history.clear')
            };
        },
        async corpus() {
            loads.push('corpus');
            return {
                inspect: command('corpus.inspect'),
                promote: command('corpus.promote'),
                migrate: command('corpus.migrate')
            };
        },
        async merge(load, request) {
            if (load !== loaders.loadConfig) {
                throw new Error('Wrong config loader.');
            }
            loads.push('merge');
            return await command('merge')(request);
        },
        async replay(input, request) {
            if (input !== loaders) {
                throw new Error('Wrong command loaders.');
            }
            loads.push('recorded');
            return await command('recorded')(request);
        }
    };
    return { commands: createCommandLineRoutes(loaders, runtime), calls, loads };
}
