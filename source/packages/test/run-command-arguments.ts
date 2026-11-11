import type { Except } from 'type-fest';
import { flag, multioption, oneOf, option, restPositionals, string, type Type } from 'cmd-ts';
import type { CommandLineListTestsRequest, CommandLineRunTestsRequest } from '../run/command-line.entry-point.ts';
import { parseRunFilterExpression, type RunFilter } from '../run/filters.entry-point.ts';
import { configPathArgument } from './command-line-config-path.ts';
import {
    profileSelectionType,
    createCommandLineSelection,
    runtimeSelectionFiltersType
} from './command-line-selection.ts';
import { runSeedType, runShardType, runWorkersType } from './run-reproducibility-parser.ts';

type RunOrder = Extract<CommandLineRunTestsRequest['runRequest']['order'], 'lexical' | 'seeded'>;
type RunSeed = CommandLineRunTestsRequest['runRequest']['seed'];
type RunShard = CommandLineRunTestsRequest['runRequest']['shard'];

export type RunCommandArguments<Profile extends string | null> = {
    readonly configPath: string | null;
    readonly record: boolean;
    readonly recordForMerge: boolean;
    readonly coverage: boolean;
    readonly lastFailed: boolean;
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

type RunOnlyArgument = 'coverage' | 'noCapture' | 'record' | 'recordForMerge' | 'timings' | 'workers';
type ListControls = { readonly withLocations: boolean; readonly withOrphans: boolean; };
export type ListCommandArguments<Profile extends string | null> = Except<
    ListControls & RunCommandArguments<Profile>,
    RunOnlyArgument
>;

const runOrderType = oneOf([ 'seeded', 'lexical' ] as const);

const filterExpressionType: Type<string, RunFilter | null> = {
    displayName: 'expr',
    async from(value) {
        await Promise.resolve();

        return parseRunFilterExpression(value);
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

export function createRunTestsRequest<Profile extends string | null>(
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
            capture: args.noCapture ? 'live' : 'buffered',
            record: args.record,
            recordForMerge: args.recordForMerge,
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
            lastFailed: args.lastFailed,
            shard: args.shard,
            timingCollection: args.timings ? 'precise' : 'profile-default',
            verbose: false,
            workers: args.workers
        }
    };
}

export function createListTestsRequest<Profile extends string | null>(
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
            lastFailed: args.lastFailed,
            withLocations: args.withLocations,
            withOrphans: args.withOrphans
        }
    };
}

export const sharedCommandArguments = {
    lastFailed: flag({ long: 'last-failed' }),
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

export const benchmarkCommandArguments = {
    ...sharedCommandArguments,
    profile: multioption({
        long: 'profile',
        type: profileSelectionType,
        defaultValue() {
            return null;
        }
    })
};

export const runExecutionArguments = {
    record: flag({ long: 'record' }),
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

export const listDisplayArguments = {
    withLocations: flag({ long: 'with-locations' }),
    withOrphans: flag({ long: 'with-orphans' })
};
