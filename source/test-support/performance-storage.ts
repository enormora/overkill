import path from 'node:path';
import { openPerformanceBaselineStore, type PerformanceStoreAccess } from '../baselines/performance-store.ts';
import { createDefaultWorkId, createCaseId } from '../engine/identity.ts';
import type { StoredPerformanceBaseline } from '../baselines/performance-baseline.ts';

export const storedPerformanceFixture: StoredPerformanceBaseline = {
    adapter: 'duration',
    expected: {
        calibration: { context: {}, kind: 'comparable', machineClass: 'unit-host', metadata: {} },
        value: { maximum: 100 }
    },
    profile: 'startup',
    subtype: 'performance-baseline',
    version: 1,
    work: createDefaultWorkId(createCaseId('startup.bench.ts', [], 'starts', null))
};
type PerformanceStorageScenario = {
    readonly ancestor: string;
    readonly regular: boolean;
    readonly maxBytes: number;
    readonly disappeared: boolean;
};
export const performanceStorageScenario: PerformanceStorageScenario = {
    ancestor: '/project',
    regular: true,
    maxBytes: 65_536,
    disappeared: false
};
type PerformanceStorage = {
    readonly store: Awaited<ReturnType<typeof openPerformanceBaselineStore>>;
    readonly access: PerformanceStoreAccess;
    readonly events: readonly string[];
    readonly seed: (relative: string, value: string) => void;
};
export async function performanceStorage(input: PerformanceStorageScenario): Promise<PerformanceStorage> {
    const content = new Map<string, string>();
    const events: string[] = [];
    const access: PerformanceStoreAccess = {
        files: {
            async read(target) {
                return input.disappeared ? null : content.get(target) ?? null;
            },
            async create(target, value) {
                if (content.has(target)) {
                    throw new Error('Destination exists.');
                }
                content.set(target, value);
                events.push('create');
            },
            async write(target, value) {
                content.set(target, value);
                events.push('update');
            }
        },
        async canonical(target) {
            return target;
        },
        async ancestor() {
            return input.ancestor;
        },
        async names(directory) {
            return Array
                .from(content.keys())
                .filter(function (target) {
                    return path.dirname(target) === directory;
                })
                .map(function (target) {
                    return path.basename(target);
                });
        },
        async inspect(target) {
            return { regular: input.regular, size: Buffer.byteLength(content.get(target) ?? '') };
        },
        async prepare() {
            events.push('prepare');
        },
        async remove(target) {
            content.delete(target);
            events.push('remove');
        }
    };
    return {
        store: await openPerformanceBaselineStore({
            projectRoot: '/project',
            directory: 'baselines',
            maxBytes: input.maxBytes
        }, access),
        access,
        events,
        seed(relative: string, value: string) {
            content.set(path.resolve('/project', relative), value);
        }
    };
}
