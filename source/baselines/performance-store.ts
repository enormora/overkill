import { createHash } from 'node:crypto';
import { lstat, mkdir, readdir, realpath, unlink } from 'node:fs/promises';
import path from 'node:path';
import { workIdentityProjection } from '../engine/identity.ts';
import { canonicalIdentityJson } from '../canonical-identity.ts';
import { createNodeFileStore, type FileStore } from '../file-store.ts';
import { snapshotJson } from '../attachments/json-snapshot.ts';
import { isPathInside, existingPathAncestor } from '../run/path-containment.ts';
import { storedPerformanceBaselineSchema } from './performance-schema.ts';
import {
    performanceBaselineIdentity,
    type BaselineChange,
    type BaselineEntry,
    type StoredPerformanceBaseline,
    type PerformanceBaselineIdentity
} from './performance-baseline.ts';

export function performanceBaselineKey(identity: PerformanceBaselineIdentity): string {
    const { measurement, ...previous } = identity;
    return canonicalIdentityJson({
        ...previous,
        ...measurement === null ? {} : { measurement },
        work: workIdentityProjection(identity.work)
    });
}

type PerformanceStoreInput = {
    readonly directory: string;
    readonly maxBytes: number;
    readonly projectRoot: string;
};
export type PerformanceStoreAccess = {
    readonly files: FileStore;
    readonly canonical: (target: string) => Promise<string>;
    readonly ancestor: (target: string) => Promise<string>;
    readonly names: (target: string) => Promise<readonly string[]>;
    readonly inspect: (target: string) => Promise<{ readonly regular: boolean; readonly size: number; }>;
    readonly prepare: (target: string) => Promise<void>;
    readonly remove: (target: string) => Promise<void>;
};
type StoreLocation = {
    readonly directory: string;
    readonly access: PerformanceStoreAccess;
    readonly maxBytes: number;
    readonly root: string;
};
export type PerformanceBaselineStore = {
    readonly list: () => Promise<readonly BaselineEntry[]>;
    readonly apply: (change: BaselineChange) => Promise<void>;
};

function baselineFilename(baseline: StoredPerformanceBaseline): string {
    const key = performanceBaselineKey(performanceBaselineIdentity(baseline));
    return `${createHash('sha256').update(key).digest('hex')}.benchmark.json`;
}

function missingFile(error: unknown): boolean {
    return error instanceof Error && Reflect.get(error, 'code') === 'ENOENT';
}

async function validateDirectory(location: StoreLocation): Promise<void> {
    if (
        !isPathInside(location.root, location.directory) ||
        !isPathInside(location.root, await location.access.ancestor(location.directory))
    ) {
        throw new Error('Performance baseline directory must remain inside the project root.');
    }
}

async function baselineNames(directory: string): Promise<readonly string[]> {
    try {
        return await readdir(directory);
    } catch (error: unknown) {
        if (missingFile(error)) {
            return [];
        }
        throw error;
    }
}

async function validateBaselineFile(location: StoreLocation, name: string, filePath: string): Promise<void> {
    const stats = await location.access.inspect(filePath);
    if (!stats.regular || stats.size > location.maxBytes) {
        throw new Error(`Invalid performance baseline file: ${name}`);
    }
}

async function readBaseline(location: StoreLocation, name: string): Promise<BaselineEntry> {
    const filePath = path.join(location.directory, name);
    await validateBaselineFile(location, name, filePath);
    const content = await location.access.files.read(filePath);
    if (content === null) {
        throw new Error(`Performance baseline disappeared while reading: ${name}`);
    }
    const parsed: unknown = JSON.parse(content);
    const baseline = storedPerformanceBaselineSchema.parse(parsed);
    if (baselineFilename(baseline) !== name) {
        throw new Error(`Performance baseline path does not match its identity: ${name}`);
    }
    return { baseline, path: path.relative(location.root, filePath).replaceAll('\\', '/') };
}

async function verifyPrevious(location: StoreLocation, change: BaselineChange, filePath: string): Promise<void> {
    const expected = change.kind === 'create'
        ? null
        : JSON.stringify(
            storedPerformanceBaselineSchema.parse(change.kind === 'update' ? change.previous : change.baseline)
        );
    const previous = await location.access.files.read(filePath);
    if (previous === null) {
        if (expected !== null) {
            throw new Error('Performance baseline disappeared during execution.');
        }
        return;
    }
    const parsed: unknown = JSON.parse(previous);
    if (JSON.stringify(storedPerformanceBaselineSchema.parse(parsed)) !== expected) {
        throw new Error('Performance baseline changed during execution. Run the command again.');
    }
}

async function persistBaseline(location: StoreLocation, change: BaselineChange, filePath: string): Promise<void> {
    const snapshot = snapshotJson(change.baseline, location.maxBytes);
    if (snapshot === null) {
        throw new Error('Performance baseline exceeds the configured artifact byte limit.');
    }
    await location.access.prepare(location.directory);
    await validateDirectory(location);
    if (change.kind === 'create') {
        await location.access.files.create(filePath, snapshot.encoded);
    } else {
        await location.access.files.write(filePath, snapshot.encoded);
    }
}

export async function openPerformanceBaselineStore(
    input: PerformanceStoreInput,
    access: PerformanceStoreAccess
): Promise<PerformanceBaselineStore> {
    const root = await access.canonical(input.projectRoot);
    const location: StoreLocation = {
        directory: path.resolve(root, input.directory, 'performance'),
        access,
        maxBytes: input.maxBytes,
        root
    };
    await validateDirectory(location);
    return {
        async list() {
            await validateDirectory(location);
            const names = await access.names(location.directory);
            const selected = names
                .filter(function performanceFile(name) {
                    return name.endsWith('.benchmark.json');
                })
                .toSorted(function alphabetical(left, right) {
                    return left.localeCompare(right);
                });
            return await Promise.all(selected.map(async function entry(name) {
                return await readBaseline(location, name);
            }));
        },
        async apply(change) {
            await validateDirectory(location);
            const filePath = path.join(location.directory, baselineFilename(change.baseline));
            await verifyPrevious(location, change, filePath);
            if (change.kind === 'remove') {
                await access.remove(filePath);
            } else {
                await persistBaseline(location, change, filePath);
            }
        }
    };
}

export async function createPerformanceBaselineStore(input: PerformanceStoreInput): Promise<PerformanceBaselineStore> {
    return await openPerformanceBaselineStore(input, {
        files: createNodeFileStore(),
        canonical: realpath,
        ancestor: existingPathAncestor,
        names: baselineNames,
        remove: unlink,
        async inspect(target) {
            const stats = await lstat(target);
            return { regular: stats.isFile(), size: stats.size };
        },
        async prepare(directory) {
            await mkdir(directory, { recursive: true });
        }
    });
}
