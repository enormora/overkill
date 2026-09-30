import type { Type } from 'cmd-ts';
import {
    all,
    contains,
    equals,
    type RunFilter,
    type RunSelection
} from '../run/filters.entry-point.ts';
import { parseRuntimeSelector } from './run-runtime-selector.ts';

export type CommandLineSelectionArguments = {
    readonly file: string | null;
    readonly filter: RunFilter | null;
    readonly runtimeFilters: readonly RunFilter[];
    readonly title: string | null;
};

export const runtimeSelectionFiltersType: Type<string[], readonly RunFilter[]> = {
    displayName: 'runtime[:variant]|runtime.dimension=value',
    async from(values) {
        await Promise.resolve();

        return values.map(parseRuntimeSelector);
    }
};

function selectionFromFilters(filters: readonly RunFilter[]): RunSelection {
    const [ firstFilter, ...remainingFilters ] = filters;

    if (firstFilter === undefined) {
        return { kind: 'all' };
    }

    return {
        filter: remainingFilters.length === 0 ? firstFilter : all([ firstFilter, ...remainingFilters ]),
        kind: 'filter'
    };
}

export function createCommandLineSelection(args: CommandLineSelectionArguments): RunSelection {
    const filters: RunFilter[] = Array.from(args.runtimeFilters);

    if (args.filter !== null) {
        filters.push(args.filter);
    }

    if (args.title !== null) {
        filters.push(contains('title', args.title));
    }

    if (args.file !== null) {
        filters.push(equals('file', args.file));
    }

    return selectionFromFilters(filters);
}
