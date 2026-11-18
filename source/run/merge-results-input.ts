import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { RunnerError } from '../engine/run-result.ts';
import { RunCollectionError, RunResolutionError, invalidRequest } from './run-errors.ts';
import { mergeRecordSchema, mergedRecordSchema, type MergeRecord } from './merge-results-schema.ts';
import type { MergeResultsCommand, MergeResultsInput } from './merge-results-types.ts';

type MergeDirectoryEntry = { readonly name: string; readonly file: boolean; };
export type MergeInputAccess = {
    readonly inspect: (path: string) => Promise<'directory' | 'file' | 'other'>;
    readonly canonical: (path: string) => Promise<string>;
    readonly children: (path: string) => Promise<readonly MergeDirectoryEntry[]>;
    readonly read: (path: string) => Promise<string>;
};
export type MergeInputRead = { readonly sources: readonly MergeSource[]; readonly errors: readonly RunnerError[]; };
export type MergeSource = { readonly path: string; readonly record: MergeRecord; };

async function mergeInputOperation<Value>(path: string, operation: () => Promise<Value>): Promise<Value> {
    try {
        return await operation();
    } catch (error: unknown) {
        if (error instanceof RunResolutionError) {
            throw error;
        }
        throw new RunCollectionError(`Cannot read merge input: ${path}`, { cause: error }, 'merge');
    }
}
async function classifyMergeInput(cwd: string, path: string, access: MergeInputAccess): Promise<MergeResultsInput> {
    const metadata = await mergeInputOperation(path, async function inspect() {
        return await access.inspect(resolve(cwd, path));
    });
    if (metadata === 'directory') {
        return { kind: 'directory', path };
    }
    if (metadata === 'file') {
        return { kind: 'file', path };
    }
    return invalidRequest(`Merge input must be a file or directory: ${path}`);
}
async function inputFiles(cwd: string, input: MergeResultsInput, access: MergeInputAccess): Promise<readonly string[]> {
    const target = resolve(cwd, input.path);
    const classified = await classifyMergeInput(cwd, input.path, access);
    if (input.kind !== 'path' && classified.kind !== input.kind) {
        return invalidRequest(`Merge input is not a ${input.kind}: ${target}`);
    }
    if (classified.kind === 'file') {
        return [ await access.canonical(target) ];
    }
    const entries = await access.children(target);
    const files = entries.filter(function recordFile(entry) {
        return entry.file && entry.name.endsWith('.json');
    });
    return await Promise.all(files.map(async function canonical(entry) {
        return await access.canonical(resolve(target, entry.name));
    }));
}

function shardOrder(left: MergeSource, right: MergeSource): number {
    const indexDifference = left.record.facts.reproducibility.shard.index -
        right.record.facts.reproducibility.shard.index;
    return indexDifference === 0 ? left.path.localeCompare(right.path) : indexDifference;
}
type MergeFiles = { readonly paths: readonly string[]; readonly errors: readonly RunnerError[]; };
async function discoverInput(cwd: string, input: MergeResultsInput, access: MergeInputAccess): Promise<MergeFiles> {
    try {
        return { paths: await inputFiles(cwd, input, access), errors: [] };
    } catch (error: unknown) {
        if (error instanceof RunResolutionError) {
            throw error;
        }
        const failure = new RunCollectionError(`Cannot read merge input: ${input.path}`, { cause: error }, 'merge');
        return { paths: [], errors: [ { ...failure.runnerError(), subtype: 'merge' } ] };
    }
}
async function decodedSources(path: string, explicit: boolean, access: MergeInputAccess): Promise<MergeInputRead> {
    const value: unknown = JSON.parse(await access.read(path));
    if (!explicit && mergedRecordSchema.safeParse(value).success) {
        return { sources: [], errors: [] };
    }
    return { sources: [ { path, record: mergeRecordSchema.parse(value) } ], errors: [] };
}
async function decodeSource(path: string, explicit: boolean, access: MergeInputAccess): Promise<MergeInputRead> {
    try {
        return await decodedSources(path, explicit, access);
    } catch (error: unknown) {
        const failure = new RunCollectionError(`Cannot read merge input: ${path}`, { cause: error }, 'merge');
        return { sources: [], errors: [ { ...failure.runnerError(), subtype: 'merge' } ] };
    }
}
async function matchesExplicitPath(
    cwd: string,
    input: MergeResultsInput,
    path: string,
    access: MergeInputAccess
): Promise<boolean> {
    const target = resolve(cwd, input.path);
    const metadata = await access.inspect(target);
    return metadata === 'file' && await access.canonical(target) === path;
}
async function explicitFile(
    cwd: string,
    input: MergeResultsInput,
    path: string,
    access: MergeInputAccess
): Promise<boolean> {
    if (input.kind === 'directory') {
        return false;
    }
    try {
        return await matchesExplicitPath(cwd, input, path, access);
    } catch {
        return false;
    }
}
export async function readMergeInput(command: MergeResultsCommand, access: MergeInputAccess): Promise<MergeInputRead> {
    const inputs = await Promise.all(command.inputs.map(async function discover(input) {
        return await discoverInput(command.cwd, input, access);
    }));
    const paths = new Set(inputs.flatMap(function discoveredPaths(input) {
        return input.paths;
    }));
    const records = await Promise.all(
        Array
            .from(paths)
            .toSorted(function alphabetical(left, right) {
                return left.localeCompare(right);
            })
            .map(async function decode(path) {
                const explicit = await Promise.all(command.inputs.map(async function explicitInput(input) {
                    return await explicitFile(command.cwd, input, path, access);
                }));
                return await decodeSource(path, explicit.includes(true), access);
            })
    );
    const sources = records
        .flatMap(function inputSources(record) {
            return record.sources;
        })
        .toSorted(shardOrder);
    const errors = [ ...inputs, ...records ].flatMap(function inputErrors(input) {
        return input.errors;
    });
    if (sources.length === 0 && errors.length === 0) {
        return invalidRequest('Merge results requires at least one run-record file.');
    }
    return { sources, errors };
}

export async function readMergeSources(command: MergeResultsCommand): Promise<MergeInputRead> {
    return await readMergeInput(command, {
        async inspect(path) {
            const metadata = await stat(path);
            if (metadata.isDirectory()) {
                return 'directory';
            }
            return metadata.isFile() ? 'file' : 'other';
        },
        canonical: realpath,
        async children(path) {
            const entries = await readdir(path, { withFileTypes: true });
            return entries.map(function entry(file) {
                return { name: file.name, file: file.isFile() };
            });
        },
        async read(path) {
            return await readFile(path, 'utf8');
        }
    });
}
