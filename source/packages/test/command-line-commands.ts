import type { Except } from 'type-fest';
import {
    command,
    flag,
    multioption,
    oneOf,
    option,
    restPositionals,
    runSafely,
    string,
    subcommands,
    type Type
} from 'cmd-ts';
import type {
    CommandLineListTestsRequest,
    CommandLineRunTestsRequest,
    CommandLineRunner,
    CommandLineRunnerResult
} from '../run/command-line.entry-point.ts';
import {
    parseRunFilterExpression,
    type RunFilter
} from '../run/filters.entry-point.ts';
import { benchmarkProfileType } from './benchmark-profile-parser.ts';
import {
    createCommandLineSelection,
    runtimeSelectionFiltersType
} from './command-line-selection.ts';
import { parseRunSeed } from './run-seed-parser.ts';
import { parseRunShard } from './run-shard-parser.ts';
import { runWorkersType } from './run-workers-parser.ts';

type RunOrder = Extract<CommandLineRunTestsRequest['runRequest']['order'], 'lexical' | 'seeded'>;
type RunSeed = CommandLineRunTestsRequest['runRequest']['seed'];
type RunShard = CommandLineRunTestsRequest['runRequest']['shard'];

type RunCommandArguments<Profile extends string | null> = {
    readonly configPath: string | null;
    readonly coverage: boolean;
    readonly file: string | null;
    readonly filter: RunFilter | null;
    readonly noCapture: boolean;
    readonly order: RunOrder;
    readonly paths: readonly string[];
    readonly profile: Profile;
    readonly runtimeFilters: readonly RunFilter[];
    readonly seed: RunSeed;
    readonly shard: RunShard;
    readonly timings: boolean;
    readonly title: string | null;
    readonly workers: CommandLineRunTestsRequest['runRequest']['workers'];
};

type ListCommandArguments<Profile extends string | null> = {
    readonly configPath: string | null;
    readonly file: string | null;
    readonly filter: RunFilter | null;
    readonly order: RunOrder;
    readonly paths: readonly string[];
    readonly profile: Profile;
    readonly runtimeFilters: readonly RunFilter[];
    readonly seed: RunSeed;
    readonly shard: RunShard;
    readonly title: string | null;
    readonly withLocations: boolean;
    readonly withOrphans: boolean;
};

const runOrderType = oneOf([ 'seeded', 'lexical' ] as const);

const configPathType: Type<string[], string | null> = {
    displayName: 'path',
    async from([ configPath, ...remainingPaths ]) {
        if (remainingPaths.length > 0) {
            throw new TypeError('--config may only be provided once.');
        }

        return configPath ?? null;
    }
};

const filterExpressionType: Type<string, RunFilter | null> = {
    displayName: 'expr',
    async from(value) {
        await Promise.resolve();

        return parseRunFilterExpression(value);
    }
};

const runSeedType: Type<string, RunSeed> = {
    displayName: 'n',
    async from(value) {
        await Promise.resolve();

        return parseRunSeed(value);
    }
};

const runShardType: Type<string, RunShard> = {
    displayName: 'i/n',
    async from(value) {
        await Promise.resolve();

        return parseRunShard(value);
    }
};

function parseNonEmptySelectorText(label: string, value: string): string {
    if (value.trim().length === 0) {
        throw new TypeError(`${label} must not be empty.`);
    }

    return value;
}

const fileSelectionType: Type<string, string | null> = {
    displayName: 'path',
    async from(value) {
        return parseNonEmptySelectorText('File selector', value);
    }
};

const titleSelectionType: Type<string, string | null> = {
    displayName: 'text',
    async from(value) {
        return parseNonEmptySelectorText('Title selector', value);
    }
};

function readCapture(args: RunCommandArguments<string | null>): CommandLineRunTestsRequest['runRequest']['capture'] {
    return args.noCapture ? 'live' : 'buffered';
}

function createRunTestsRequest<Profile extends string | null>(
    args: RunCommandArguments<Profile>,
    cwd: string
): Except<CommandLineRunTestsRequest, 'runRequest'> & {
    readonly runRequest: Except<CommandLineRunTestsRequest['runRequest'], 'profile'> & { readonly profile: Profile; };
} {
    return {
        configPath: args.configPath,
        cwd,
        runRequest: {
            baselineUpdateMode: 'none',
            capabilityRestrictions: { mode: 'enabled' },
            capture: readCapture(args),
            coverage: args.coverage,
            debug: {
                mode: 'off',
                selectors: []
            },
            execution: { mode: 'profile-default' },
            measureProcessUsage: null,
            order: args.order,
            paths: args.paths,
            profile: args.profile,
            processBudgetOverrides: null,
            processUsageSamplingIntervalMilliseconds: null,
            seed: args.seed,
            selection: createCommandLineSelection(args),
            shard: args.shard,
            timingCollection: args.timings ? 'precise' : 'profile-default',
            verbose: false,
            workers: args.workers
        }
    };
}

function createListTestsRequest<Profile extends string | null>(
    args: ListCommandArguments<Profile>,
    cwd: string
): Except<CommandLineListTestsRequest, 'listRequest'> & {
    readonly listRequest: Except<CommandLineListTestsRequest['listRequest'], 'profile'> & {
        readonly profile: Profile;
    };
} {
    return {
        configPath: args.configPath,
        cwd,
        listRequest: {
            order: args.order,
            paths: args.paths,
            profile: args.profile,
            seed: args.seed,
            shard: args.shard,
            selection: createCommandLineSelection(args),
            withLocations: args.withLocations,
            withOrphans: args.withOrphans
        }
    };
}

const configPathArgument = multioption({
    long: 'config',
    type: configPathType,
    defaultValue() {
        return null;
    }
});

const sharedCommandArguments = {
    configPath: configPathArgument,
    file: option({
        long: 'file',
        type: fileSelectionType,
        defaultValue() {
            return null;
        }
    }),
    filter: option({
        long: 'filter',
        type: filterExpressionType,
        defaultValue() {
            return null;
        }
    }),
    order: option({
        long: 'order',
        type: runOrderType,
        defaultValue() {
            return 'seeded' as const;
        }
    }),
    seed: option({
        long: 'seed',
        type: runSeedType,
        defaultValue() {
            return { value: null };
        }
    }),
    shard: option({
        long: 'shard',
        type: runShardType,
        defaultValue() {
            return { index: 1, total: 1 };
        }
    }),
    title: option({
        long: 'title',
        type: titleSelectionType,
        defaultValue() {
            return null;
        }
    }),
    paths: restPositionals({ displayName: 'path' }),
    profile: option({
        long: 'profile',
        type: string,
        defaultValue() {
            return 'microtest';
        }
    }),
    runtimeFilters: multioption({
        long: 'runtime',
        type: runtimeSelectionFiltersType,
        defaultValue() {
            return [];
        }
    })
};

const benchmarkCommandArguments = {
    ...sharedCommandArguments,
    profile: multioption({
        long: 'profile',
        type: benchmarkProfileType,
        defaultValue() {
            return null;
        }
    })
};

const runExecutionArguments = {
    noCapture: flag({ long: 'no-capture' }),
    timings: flag({ long: 'timings' }),
    workers: option({
        long: 'workers',
        type: runWorkersType,
        defaultValue() {
            return null;
        }
    })
};

const listDisplayArguments = {
    withLocations: flag({ long: 'with-locations' }),
    withOrphans: flag({ long: 'with-orphans' })
};

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

export async function dispatchOverkillCommand(
    commandArguments: readonly string[],
    loadRunner: () => Promise<CommandLineRunner>,
    cwd: string
): Promise<CommandLineDispatchResult> {
    const runCommand = command({
        name: 'run',
        args: {
            ...sharedCommandArguments,
            coverage: flag({ long: 'coverage' }),
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
                                    async handler(args: Except<RunCommandArguments<string | null>, 'coverage'>) {
                                        const runner = await loadRunner();
                                        const request = createRunTestsRequest({ ...args, coverage: false }, cwd);
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
                    return await runner.bench.calibrate(createRunTestsRequest({ ...args, coverage: false }, cwd));
                }
            }),
            run: command({
                name: 'run',
                args: { ...benchmarkCommandArguments, ...runExecutionArguments },
                async handler(args: Except<RunCommandArguments<string | null>, 'coverage'>) {
                    const runner = await loadRunner();

                    return await runner.bench.runBenchmarks(createRunTestsRequest({ ...args, coverage: false }, cwd));
                }
            })
        }
    });

    const commandLine = subcommands({
        name: 'overkill',
        cmds: { bench: benchmarkCommand, list: listCommand, run: runCommand }
    });
    const result = await runSafely(commandLine, Array.from(commandArguments));
    const { _tag: parserStatus } = result;
    if (parserStatus === 'error') {
        return { kind: 'parser-exit', exit: result.error.config };
    }

    return {
        kind: 'command-result',
        result: result.value.command === 'bench'
            ? await benchmarkCommandResult(result.value.value)
            : await result.value.value
    };
}
