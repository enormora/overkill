import { createHash } from 'node:crypto';
import { lstat, mkdir, readdir, realpath, unlink } from 'node:fs/promises';
import path from 'node:path';
import { canonicalIdentityJson } from '../canonical-identity.ts';
import { createNodeFileStore, type FileStore } from '../file-store.ts';
import { snapshotJson } from '../attachments/json-snapshot.ts';
import { isPathInside } from '../run/path-containment.ts';
import { storedPerformanceBaselineSchema } from './performance-schema.ts';
import {
    performanceBaselineIdentity,
    type BaselineChange,
    type BaselineEntry,
    type StoredPerformanceBaseline,
    type PerformanceBaselineIdentity
} from './performance-baseline.ts';

export const performanceBaselineKey: (identity: PerformanceBaselineIdentity) => string = canonicalIdentityJson;

type PerformanceStoreInput = {
    readonly directory: string;
    readonly maxBytes: number;
    readonly projectRoot: string;
};
type StoreLocation = {
    readonly directory: string;
    readonly files: FileStore;
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

async function existingAncestor(candidate: string): Promise<string> {
    try {
        return await realpath(candidate);
    } catch (error: unknown) {
        const parent = path.dirname(candidate);
        if (!missingFile(error) || parent === candidate) {
            throw error;
        }
        return await existingAncestor(parent);
    }
}

async function validateDirectory(location: StoreLocation): Promise<void> {
    if (
        !isPathInside(location.root, location.directory) ||
        !isPathInside(location.root, await existingAncestor(location.directory))
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
    const stats = await lstat(filePath);
    if (!stats.isFile() || stats.size > location.maxBytes) {
        throw new Error(`Invalid performance baseline file: ${name}`);
    }
}

async function readBaseline(location: StoreLocation, name: string): Promise<BaselineEntry> {
    const filePath = path.join(location.directory, name);
    await validateBaselineFile(location, name, filePath);
    const content = await location.files.read(filePath);
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
        : JSON.stringify(change.kind === 'update' ? change.previous : change.baseline);
    const previous = await location.files.read(filePath);
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
    await mkdir(location.directory, { recursive: true });
    await validateDirectory(location);
    if (change.kind === 'create') {
        await location.files.create(filePath, snapshot.encoded);
    } else {
        await location.files.write(filePath, snapshot.encoded);
    }
}

export async function createPerformanceBaselineStore(input: PerformanceStoreInput): Promise<PerformanceBaselineStore> {
    const root = await realpath(input.projectRoot);
    const location: StoreLocation = {
        directory: path.resolve(root, input.directory, 'performance'),
        files: createNodeFileStore(),
        maxBytes: input.maxBytes,
        root
    };
    await validateDirectory(location);
    return {
        async list() {
            await validateDirectory(location);
            const names = await baselineNames(location.directory);
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
                await unlink(filePath);
            } else {
                await persistBaseline(location, change, filePath);
            }
        }
    };
}
