import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { NonEmptyReadonlyArray } from '../assertion-protocol/assertion-node-shape.ts';
import { RunCollectionError, RunResolutionError, invalidRequest } from './run-errors.ts';
import { mergeRecordSchema, type MergeRecord } from './merge-results-schema.ts';
import type { MergeResultsCommand, MergeResultsInput } from './merge-results-types.ts';

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
export async function classifyMergeInput(cwd: string, path: string): Promise<MergeResultsInput> {
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
    if (classified.kind !== input.kind) {
        return invalidRequest(`Merge input is not a ${input.kind}: ${target}`);
    }
    if (input.kind === 'file') {
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
async function readSource(path: string): Promise<MergeSource> {
    return { path, record: mergeRecordSchema.parse(JSON.parse(await readFile(path, 'utf8'))) };
}
function shardOrder(left: MergeSource, right: MergeSource): number {
    const indexDifference = left.record.facts.reproducibility.shard.index -
        right.record.facts.reproducibility.shard.index;
    return indexDifference === 0 ? left.path.localeCompare(right.path) : indexDifference;
}
export async function readMergeSources(command: MergeResultsCommand): Promise<NonEmptyReadonlyArray<MergeSource>> {
    const paths = new Set<string>();
    for (const input of command.inputs) {
        const files = await mergeInputOperation(input.path, async function discover() {
            return await inputFiles(command.cwd, input);
        });
        for (const path of files) {
            paths.add(path);
        }
    }
    const sources = await Promise.all(
        Array
            .from(paths)
            .toSorted(function alphabetical(left, right) {
                return left.localeCompare(right);
            })
            .map(async function read(path) {
                return await mergeInputOperation(path, async function decode() {
                    return await readSource(path);
                });
            })
    );
    const [ first, ...rest ] = sources.toSorted(shardOrder);
    if (first === undefined) {
        return invalidRequest('Merge results requires at least one run-record file.');
    }
    return [ first, ...rest ];
}
