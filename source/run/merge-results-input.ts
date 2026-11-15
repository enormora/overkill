import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { RunnerError } from '../engine/run-result.ts';
import { RunCollectionError, RunResolutionError, invalidRequest } from './run-errors.ts';
import { mergeRecordSchema, mergedRecordSchema, type MergeRecord } from './merge-results-schema.ts';
import type { MergeResultsCommand, MergeResultsInput } from './merge-results-types.ts';

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
async function classifyMergeInput(cwd: string, path: string): Promise<MergeResultsInput> {
    const metadata = await mergeInputOperation(path, async function inspect() {
        return await stat(resolve(cwd, path));
    });
    if (metadata.isDirectory()) {
        return { kind: 'directory', path };
    }
    if (metadata.isFile()) {
        return { kind: 'file', path };
    }
    return invalidRequest(`Merge input must be a file or directory: ${path}`);
}
async function inputFiles(cwd: string, input: MergeResultsInput): Promise<readonly string[]> {
    const target = resolve(cwd, input.path);
    const classified = await classifyMergeInput(cwd, input.path);
    if (input.kind !== 'path' && classified.kind !== input.kind) {
        return invalidRequest(`Merge input is not a ${input.kind}: ${target}`);
    }
    if (classified.kind === 'file') {
        return [ await realpath(target) ];
    }
    const entries = await readdir(target, { withFileTypes: true });
    const files = entries.filter(function recordFile(entry) {
        return entry.isFile() && entry.name.endsWith('.json');
    });
    return await Promise.all(files.map(async function canonical(entry) {
        return await realpath(resolve(target, entry.name));
    }));
}

function shardOrder(left: MergeSource, right: MergeSource): number {
    const indexDifference = left.record.facts.reproducibility.shard.index -
        right.record.facts.reproducibility.shard.index;
    return indexDifference === 0 ? left.path.localeCompare(right.path) : indexDifference;
}
type MergeFiles = { readonly paths: readonly string[]; readonly errors: readonly RunnerError[]; };
async function discoverInput(cwd: string, input: MergeResultsInput): Promise<MergeFiles> {
    try {
        return { paths: await inputFiles(cwd, input), errors: [] };
    } catch (error: unknown) {
        if (error instanceof RunResolutionError) {
            throw error;
        }
        const failure = new RunCollectionError(`Cannot read merge input: ${input.path}`, { cause: error }, 'merge');
        return { paths: [], errors: [ { ...failure.runnerError(), subtype: 'merge' } ] };
    }
}
async function decodedSources(path: string, explicit: boolean): Promise<MergeInputRead> {
    const value: unknown = JSON.parse(await readFile(path, 'utf8'));
    if (!explicit && mergedRecordSchema.safeParse(value).success) {
        return { sources: [], errors: [] };
    }
    return { sources: [ { path, record: mergeRecordSchema.parse(value) } ], errors: [] };
}
async function decodeSource(path: string, explicit: boolean): Promise<MergeInputRead> {
    try {
        return await decodedSources(path, explicit);
    } catch (error: unknown) {
        const failure = new RunCollectionError(`Cannot read merge input: ${path}`, { cause: error }, 'merge');
        return { sources: [], errors: [ { ...failure.runnerError(), subtype: 'merge' } ] };
    }
}
async function matchesExplicitPath(cwd: string, input: MergeResultsInput, path: string): Promise<boolean> {
    const target = resolve(cwd, input.path);
    const metadata = await stat(target);
    return metadata.isFile() && await realpath(target) === path;
}
async function explicitFile(cwd: string, input: MergeResultsInput, path: string): Promise<boolean> {
    if (input.kind === 'directory') {
        return false;
    }
    try {
        return await matchesExplicitPath(cwd, input, path);
    } catch {
        return false;
    }
}
export async function readMergeSources(command: MergeResultsCommand): Promise<MergeInputRead> {
    const inputs = await Promise.all(command.inputs.map(async function discover(input) {
        return await discoverInput(command.cwd, input);
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
                    return await explicitFile(command.cwd, input, path);
                }));
                return await decodeSource(path, explicit.includes(true));
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
