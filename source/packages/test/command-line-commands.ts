import { command, flag, restPositionals, runSafely, string, subcommands } from 'cmd-ts';
import type { CommandLineRunner, CommandLineRunnerResult } from '../run/command-line.entry-point.ts';
import { createWitnessReplayCommand } from './witness-replay-command.ts';
import { configPathArgument, configPathType } from './command-line-config-path.ts';
import { createCorpusCommand } from './corpus-command.ts';
import { createBaselineCommand } from './baseline-command.ts';
import { runSeedType } from './run-reproducibility-parser.ts';
import {
    sharedCommandArguments,
    benchmarkCommandArguments,
    runExecutionArguments,
    listDisplayArguments,
    createRunTestsRequest,
    createListTestsRequest,
    type RunCommandArguments,
    type ListCommandArguments
} from './run-command-arguments.ts';

export type CommandLineParserExit = {
    readonly exitCode: number;
    readonly into: 'stderr' | 'stdout';
    readonly message: string;
};

type DispatchedCommandResult = {
    readonly kind: 'command-result';
    readonly result: CommandLineRunnerResult;
};

type ParserExitResult = {
    readonly kind: 'parser-exit';
    readonly exit: CommandLineParserExit;
};

type CommandLineDispatchResult = DispatchedCommandResult | ParserExitResult;

type ParsedBenchmarkRun = {
    readonly command: 'calibrate' | 'list' | 'run';
    readonly value: Promise<CommandLineRunnerResult>;
};
type ParsedBenchmarkBaseline = {
    readonly command: 'baseline';
    readonly value: { readonly value: Promise<CommandLineRunnerResult>; };
};

async function benchmarkCommandResult(
    parsed: ParsedBenchmarkBaseline | ParsedBenchmarkRun
): Promise<CommandLineRunnerResult> {
    return parsed.command === 'baseline' ? await parsed.value.value : await parsed.value;
}

type ParsedBenchmark = { readonly command: 'bench'; readonly value: ParsedBenchmarkBaseline | ParsedBenchmarkRun; };
type ParsedOrdinary = {
    readonly command: 'list' | 'replay' | 'replay-witness' | 'run';
    readonly value: Promise<CommandLineRunnerResult>;
};
type ParsedCommandNamespace = {
    readonly command: 'baseline' | 'corpus' | 'history';
    readonly value: { readonly value: Promise<CommandLineRunnerResult>; };
};
type ParsedRoot = ParsedBenchmark | ParsedCommandNamespace | ParsedOrdinary;
function isCommandNamespace(parsed: ParsedRoot): parsed is ParsedCommandNamespace {
    return [ 'baseline', 'corpus', 'history' ].includes(parsed.command);
}
async function resolvedCommandResult(parsed: ParsedRoot): Promise<CommandLineRunnerResult> {
    if (parsed.command === 'bench') {
        return await benchmarkCommandResult(parsed.value);
    }
    if (isCommandNamespace(parsed)) {
        return await parsed.value.value;
    }
    return await parsed.value;
}
export async function dispatchOverkillCommand(
    commandArguments: readonly string[],
    loadRunner: () => Promise<CommandLineRunner>,
    cwd: string,
    writePreview: (lines: readonly string[]) => Promise<void>
): Promise<CommandLineDispatchResult> {
    const runCommand = command({
        name: 'run',
        args: {
            ...sharedCommandArguments,
            coverage: flag({ long: 'coverage' }),
            recordForMerge: flag({ long: 'record-for-merge' }),
            ...runExecutionArguments
        },
        async handler(args: RunCommandArguments<string>) {
            const runner = await loadRunner();

            return await runner.runTests(createRunTestsRequest(args, cwd));
        }
    });
    const listCommand = command({
        name: 'list',
        args: {
            ...sharedCommandArguments,
            ...listDisplayArguments
        },
        async handler(args: ListCommandArguments<string>) {
            const runner = await loadRunner();

            return await runner.listTests(createListTestsRequest(args, cwd));
        }
    });

    const benchmarkCommand = subcommands({
        name: 'bench',
        description: 'Benchmark commands.',
        cmds: {
            baseline: subcommands({
                name: 'baseline',
                description: 'Performance baseline commands.',
                cmds: {
                    ...Object.fromEntries(
                        ([ 'apply', 'bootstrap', 'diff', 'update' ] as const).map(function baselineVerb(verb) {
                            return [
                                verb,
                                command({
                                    name: verb,
                                    args: { ...benchmarkCommandArguments, ...runExecutionArguments },
                                    async handler(args) {
                                        const runner = await loadRunner();
                                        const request = createRunTestsRequest(
                                            { ...args, coverage: false, recordForMerge: false },
                                            cwd
                                        );
                                        return await runner.bench.baseline[verb](request);
                                    }
                                })
                            ];
                        })
                    ),
                    list: command({
                        name: 'list',
                        args: {
                            configPath: benchmarkCommandArguments.configPath,
                            paths: benchmarkCommandArguments.paths,
                            profile: benchmarkCommandArguments.profile
                        },
                        async handler(args) {
                            const runner = await loadRunner();
                            return await runner.bench.baseline.list({
                                configPath: args.configPath,
                                cwd,
                                listRequest: { paths: args.paths, profile: args.profile }
                            });
                        }
                    })
                }
            }),
            list: command({
                name: 'list',
                args: { ...benchmarkCommandArguments, ...listDisplayArguments },
                async handler(args: ListCommandArguments<string | null>) {
                    const runner = await loadRunner();

                    return await runner.bench.listBenchmarks(createListTestsRequest(args, cwd));
                }
            }),
            calibrate: command({
                name: 'calibrate',
                description: 'Capture benchmark calibration references.',
                args: { ...benchmarkCommandArguments, ...runExecutionArguments },
                async handler(args) {
                    const runner = await loadRunner();
                    return await runner.bench.calibrate(
                        createRunTestsRequest({ ...args, coverage: false, recordForMerge: false }, cwd)
                    );
                }
            }),
            run: command({
                name: 'run',
                args: { ...benchmarkCommandArguments, ...runExecutionArguments },
                async handler(args) {
                    const runner = await loadRunner();

                    return await runner.bench.runBenchmarks(
                        createRunTestsRequest({ ...args, coverage: false, recordForMerge: false }, cwd)
                    );
                }
            })
        }
    });

    const historyCommand = subcommands({
        name: 'history',
        cmds: {
            list: command({
                name: 'list',
                args: { configPath: configPathArgument },
                async handler(args) {
                    const runner = await loadRunner();
                    return await runner.history.list({ cwd, configPath: args.configPath, dryRun: false, yes: false });
                }
            }),
            prune: command({
                name: 'prune',
                args: { configPath: configPathArgument, dryRun: flag({ long: 'dry-run' }) },
                async handler(args) {
                    const runner = await loadRunner();
                    return await runner.history.prune({
                        cwd,
                        configPath: args.configPath,
                        dryRun: args.dryRun,
                        yes: false
                    });
                }
            }),
            compact: command({
                name: 'compact',
                args: { configPath: configPathArgument },
                async handler(args) {
                    const runner = await loadRunner();
                    return await runner.history.compact({
                        cwd,
                        configPath: args.configPath,
                        dryRun: false,
                        yes: false
                    });
                }
            }),
            clear: command({
                name: 'clear',
                args: { configPath: configPathArgument, yes: flag({ long: 'yes' }) },
                async handler(args) {
                    const runner = await loadRunner();
                    return await runner.history.clear({
                        cwd,
                        configPath: args.configPath,
                        dryRun: false,
                        yes: args.yes
                    });
                }
            })
        }
    });
    const commandLine = subcommands({
        name: 'overkill',
        cmds: {
            replay: command({
                name: 'replay',
                args: { configPath: configPathArgument, arguments: restPositionals({ type: string }) },
                async handler(args) {
                    const runner = await loadRunner();
                    return await runner.replayRun({ cwd, configPath: args.configPath, arguments: args.arguments });
                }
            }),
            'replay-witness': createWitnessReplayCommand(loadRunner, cwd, {
                config: configPathType,
                seed: runSeedType
            }),
            corpus: createCorpusCommand(loadRunner, cwd, writePreview),
            history: historyCommand,
            baseline: createBaselineCommand(loadRunner, cwd),
            bench: benchmarkCommand,
            list: listCommand,
            run: runCommand
        }
    });
    const result = await runSafely(commandLine, Array.from(commandArguments));
    const { _tag: parserStatus } = result;
    if (parserStatus === 'error') {
        return { kind: 'parser-exit', exit: result.error.config };
    }
    return { kind: 'command-result', result: await resolvedCommandResult(result.value) };
}
