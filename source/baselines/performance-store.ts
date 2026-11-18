import { createHash } from 'node:crypto';
import { mkdir, readdir, realpath, unlink } from 'node:fs/promises';
import path from 'node:path';
import { canonicalIdentityJson } from '../canonical-identity.ts';
import { workIdentityProjection } from '../engine/identity.ts';
import { createBaselineStorage, baselineFileStatus, type BaselineStorageAccess } from '../run/baseline-storage.ts';
import { createNodeFileStore } from '../file-store.ts';
import { existingPathAncestor } from '../run/path-containment.ts';
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
export type PerformanceBaselineStore = {
    readonly list: () => Promise<readonly BaselineEntry[]>;
    readonly apply: (change: BaselineChange) => Promise<void>;
};
type PerformanceStoreInput = { readonly directory: string; readonly projectRoot: string; readonly maxBytes: number; };
async function baselineNames(directory: string): Promise<readonly string[]> {
    try {
        return await readdir(directory);
    } catch (error: unknown) {
        if (error instanceof Error && Reflect.get(error, 'code') === 'ENOENT') {
            return [];
        }
        throw error;
    }
}
export type PerformanceStoreAccess = BaselineStorageAccess & {
    readonly canonical: (target: string) => Promise<string>;
    readonly names: (target: string) => Promise<readonly string[]>;
    readonly prepare: (target: string) => Promise<void>;
};
export async function openPerformanceBaselineStore(
    input: PerformanceStoreInput,
    access: PerformanceStoreAccess
): Promise<PerformanceBaselineStore> {
    const root = await access.canonical(input.projectRoot);
    const directory = path.resolve(root, input.directory, 'performance');
    const storage = createBaselineStorage({
        root,
        directory,
        maxBytes: input.maxBytes,
        schema: storedPerformanceBaselineSchema,
        relativePath(baseline: StoredPerformanceBaseline) {
            const key = performanceBaselineKey(performanceBaselineIdentity(baseline));
            return `${createHash('sha256').update(key).digest('hex')}.benchmark.json`;
        }
    }, {
        ...access,
        files: {
            read: access.files.read,
            async create(file, content) {
                await access.prepare(path.dirname(file));
                await access.files.create(file, content);
            },
            async write(file, content) {
                await access.prepare(path.dirname(file));
                await access.files.write(file, content);
            }
        }
    });
    await storage.checkDirectory(directory);
    return {
        async list() {
            await storage.checkDirectory(directory);
            const names = await access.names(directory);
            return await Array.fromAsync(
                names
                    .filter(function baseline(name) {
                        return name.endsWith('.benchmark.json');
                    })
                    .toSorted(function alphabetical(left, right) {
                        return left.localeCompare(right);
                    }),
                async function entry(name) {
                    const file = path.join(directory, name);
                    const baseline = await storage.read(file);
                    if (baseline === null) {
                        throw new Error('Baseline disappeared while listing.');
                    }
                    return { baseline, path: path.relative(root, file).replaceAll('\\', '/') };
                }
            );
        },
        apply: storage.apply
    };
}

export async function createPerformanceBaselineStore(input: PerformanceStoreInput): Promise<PerformanceBaselineStore> {
    return await openPerformanceBaselineStore(input, {
        files: createNodeFileStore(),
        canonical: realpath,
        ancestor: existingPathAncestor,
        inspect: baselineFileStatus,
        names: baselineNames,
        remove: unlink,
        async prepare(directory) {
            await mkdir(directory, { recursive: true });
        }
    });
}
