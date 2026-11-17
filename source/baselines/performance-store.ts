import { createHash } from 'node:crypto';
import { readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { canonicalIdentityJson } from '../canonical-identity.ts';
import { workIdentityProjection } from '../engine/identity.ts';
import { createBaselineStorage } from '../run/baseline-storage.ts';
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
export async function createPerformanceBaselineStore(input: PerformanceStoreInput): Promise<PerformanceBaselineStore> {
    const root = await realpath(input.projectRoot);
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
    });
    await storage.checkDirectory(directory);
    return {
        async list() {
            await storage.checkDirectory(directory);
            const names = await readdir(directory).catch(function missingDirectory(error: unknown) {
                if (error instanceof Error && Reflect.get(error, 'code') === 'ENOENT') {
                    return [];
                }
                throw error;
            });
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
