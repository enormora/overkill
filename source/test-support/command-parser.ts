import type { CommandLineRunner } from '../run/command-line-runner.ts';
import type { CommandLineRunnerResult } from '../run/command-line-command.ts';
import { dispatchOverkillCommand } from '../packages/test/command-line-commands.ts';

type CommandDispatch = Awaited<ReturnType<typeof dispatchOverkillCommand>>;
type CommandCall = { readonly verb: string; readonly request: unknown; };
type CommandParserFixture = {
    readonly calls: readonly CommandCall[];
    readonly loads: () => number;
    readonly previews: readonly string[];
    readonly dispatch: (args: readonly string[]) => Promise<CommandDispatch>;
};
export function commandParser(failure: Error | null): CommandParserFixture {
    const calls: CommandCall[] = [];
    const previews: string[] = [];
    let loads = 0;
    function command(verb: string): (request: unknown) => Promise<CommandLineRunnerResult> {
        return async function (request) {
            calls.push({ verb, request });
            if (failure !== null) {
                throw failure;
            }
            return { exitCode: 0, runResult: null, stdoutLines: [ verb ], fallbackDiagnostics: [] };
        };
    }
    const baseline = {
        apply: command('baseline.apply'),
        bootstrap: command('baseline.bootstrap'),
        diff: command('baseline.diff'),
        list: command('baseline.list'),
        update: command('baseline.update')
    };
    const runner: CommandLineRunner = {
        runTests: command('run'),
        listTests: command('list'),
        replayRun: command('replay'),
        replayWitness: command('witness'),
        mergeResults: command('merge'),
        history: {
            list: command('history.list'),
            prune: command('history.prune'),
            compact: command('history.compact'),
            clear: command('history.clear')
        },
        corpus: {
            inspect: command('corpus.inspect'),
            promote: command('corpus.promote'),
            migrate: command('corpus.migrate')
        },
        baseline,
        bench: {
            baseline,
            listBenchmarks: command('bench.list'),
            runBenchmarks: command('bench.run'),
            calibrate: command('bench.calibrate')
        }
    };
    return {
        calls,
        previews,
        loads() {
            return loads;
        },
        async dispatch(args) {
            return await dispatchOverkillCommand(
                args,
                async function () {
                    loads += 1;
                    return runner;
                },
                '/project',
                async function (lines) {
                    previews.push(...lines);
                }
            );
        }
    };
}
