import { mkdir, readdir, realpath, unlink } from 'node:fs/promises';
import path from 'node:path';
import properLockfile from 'proper-lockfile';
import { createNodeFileStore, type FileStore } from '../file-store.ts';
import { existingPathAncestor } from './path-containment.ts';
import { createBaselineStorage, baselineFileStatus, type BaselineStorageAccess } from './baseline-storage.ts';
import { createBaselinePublication, type BaselineStoreCommit } from './baseline-publication.ts';
import {
    storedOrdinaryBaselineSchema,
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
function previousBaseline(change: OrdinaryBaselineChange): StoredOrdinaryBaseline | null {
    if (change.kind === 'create') {
        return null;
    }
    return change.kind === 'update' ? change.previous : change.baseline;
}
export type OrdinaryBaselineAccess = BaselineStorageAccess & {
    readonly files: Pick<FileStore, 'create' | 'read' | 'write'>;
    readonly canonical: (path: string) => Promise<string>;
    readonly names: (path: string) => Promise<readonly string[]>;
    readonly prepare: (path: string) => Promise<void>;
    readonly remove: (path: string) => Promise<void>;
    readonly lock: (path: string) => Promise<() => Promise<void>>;
};
export async function openOrdinaryBaselineStore(
    input: BaselineStoreInput,
    access: OrdinaryBaselineAccess
): Promise<OrdinaryBaselineStore> {
    const root = await access.canonical(input.projectRoot);
    const directory = path.resolve(root, input.directory);
    const { checkDirectory, location, encoded, read } = createBaselineStorage({
        root,
        directory,
        maxBytes: input.maxBytes
    }, access);
    async function validateChange(change: OrdinaryBaselineChange): Promise<void> {
        await checkDirectory(directory);
        const previous = await read(location(change.baseline));
        const expected = previousBaseline(change);
        const normalized = expected === null ? null : storedOrdinaryBaselineSchema.parse(expected);
        if (JSON.stringify(previous) !== JSON.stringify(normalized)) {
            throw new Error('Baseline changed during execution. Run the command again.');
        }
        if (change.kind !== 'remove') {
            encoded(change.baseline);
        }
    }
    async function listSubtype(subtype: string): Promise<readonly OrdinaryBaselineEntry[]> {
        const selected = path.join(directory, subtype);
        await checkDirectory(selected);
        const allNames = await access.names(selected);
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
    async function applyChange(change: OrdinaryBaselineChange): Promise<void> {
        await validateChange(change);
        const file = location(change.baseline);
        if (change.kind === 'remove') {
            await access.remove(file);
        } else if (change.kind === 'create') {
            await access.files.create(file, encoded(change.baseline));
        } else {
            await access.files.write(file, encoded(change.baseline));
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
        publish: createBaselinePublication({
            validate: validateChanges,
            apply: applyChange,
            async acquire() {
                await checkDirectory(directory);
                await access.prepare(directory);
                await checkDirectory(directory);
                return await access.lock(directory);
            }
        })
    };
}

export async function createOrdinaryBaselineStore(input: BaselineStoreInput): Promise<OrdinaryBaselineStore> {
    return await openOrdinaryBaselineStore(input, {
        files: createNodeFileStore(),
        canonical: realpath,
        ancestor: existingPathAncestor,
        inspect: baselineFileStatus,
        names,
        async prepare(directory) {
            await mkdir(directory, { recursive: true });
        },
        remove: unlink,
        async lock(directory) {
            return await properLockfile.lock(directory, { realpath: false });
        }
    });
}
