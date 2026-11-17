import { readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createBaselineStorage } from './baseline-storage.ts';
import { createBaselinePublication, type BaselineStoreCommit } from './baseline-publication.ts';
import {
    storedOrdinaryBaselineSchema,
    baselineFilename,
    type StoredOrdinaryBaseline,
    type OrdinaryBaselineEntry,
    type OrdinaryBaselineChange
} from './baseline-record.ts';

export type OrdinaryBaselineStore = {
    readonly publish: (changes: readonly OrdinaryBaselineChange[]) => Promise<BaselineStoreCommit>;
    readonly list: () => Promise<readonly OrdinaryBaselineEntry[]>;
    readonly validate: (changes: readonly OrdinaryBaselineChange[]) => Promise<void>;
    readonly apply: (change: OrdinaryBaselineChange) => Promise<void>;
};
type BaselineStoreInput = { readonly directory: string; readonly projectRoot: string; readonly maxBytes: number; };
function missing(error: unknown): boolean {
    return error instanceof Error && Reflect.get(error, 'code') === 'ENOENT';
}
async function names(directory: string): Promise<readonly string[]> {
    try {
        return await readdir(directory);
    } catch (error: unknown) {
        if (missing(error)) {
            return [];
        }
        throw error;
    }
}
export async function createOrdinaryBaselineStore(input: BaselineStoreInput): Promise<OrdinaryBaselineStore> {
    const root = await realpath(input.projectRoot);
    const directory = path.resolve(root, input.directory);
    const {
        checkDirectory,
        read,
        validate: validateChange,
        apply: applyChange
    } = createBaselineStorage<StoredOrdinaryBaseline>({
        schema: storedOrdinaryBaselineSchema,
        relativePath(baseline) {
            return path.join(baseline.subtype, baselineFilename(baseline));
        },
        root,
        directory,
        maxBytes: input.maxBytes
    });
    async function listSubtype(subtype: string): Promise<readonly OrdinaryBaselineEntry[]> {
        const selected = path.join(directory, subtype);
        await checkDirectory(selected);
        const allNames = await names(selected);
        const selectedNames = allNames
            .filter(function baselineFile(name) {
                return name.endsWith('.baseline.json');
            })
            .toSorted(function alphabetical(left, right) {
                return left.localeCompare(right);
            });
        return await Array.fromAsync(selectedNames, async function entry(name) {
            const file = path.join(selected, name);
            const baseline = await read(file);
            if (baseline === null) {
                throw new Error('Baseline disappeared while listing.');
            }
            return { baseline, path: path.relative(root, file).replaceAll('\\', '/') };
        });
    }
    async function validateChanges(changes: readonly OrdinaryBaselineChange[]): Promise<void> {
        for (const change of changes) {
            await validateChange(change);
        }
    }
    await checkDirectory(directory);
    return {
        async list() {
            const groups = await Array.fromAsync(storedOrdinaryBaselineSchema.shape.subtype.options, listSubtype);
            return groups.flat();
        },
        validate: validateChanges,
        apply: applyChange,
        publish: createBaselinePublication({ directory, checkDirectory, validate: validateChanges, apply: applyChange })
    };
}
