import path from 'node:path';
import { openCalibrationReferenceStore, type CalibrationStoreAccess } from '../baselines/calibration-store.ts';

export type CalibrationStorageScenario = {
    readonly missingRoot: boolean;
    readonly ancestor: string;
    readonly regular: boolean;
    readonly maxBytes: number;
    readonly writeFailure: number | null;
    readonly removalFailure: number | null;
};
export const calibrationStorageScenario: CalibrationStorageScenario = {
    missingRoot: false,
    ancestor: '/project',
    regular: true,
    maxBytes: 65_536,
    writeFailure: null,
    removalFailure: null
};
type CalibrationStorage = {
    readonly store: Awaited<ReturnType<typeof openCalibrationReferenceStore>>;
    readonly access: CalibrationStoreAccess;
    readonly failure: Error;
    readonly events: readonly string[];
    readonly seed: (relative: string, value: string) => void;
};
export async function calibrationStorage(input: CalibrationStorageScenario): Promise<CalibrationStorage> {
    const content = new Map<string, string>();
    const events: string[] = [];
    const failure = new Error('Storage unavailable.');
    let writes = 0;
    let removals = 0;
    const access: CalibrationStoreAccess = {
        files: {
            async read(target) {
                return content.get(target) ?? null;
            },
            async write(target, value) {
                writes += 1;
                if (writes === input.writeFailure) {
                    throw failure;
                }
                content.set(target, value);
            }
        },
        async canonical(target) {
            if (input.missingRoot) {
                throw Object.assign(new Error('Missing root.'), { code: 'ENOENT' });
            }
            return target;
        },
        async ancestor() {
            return input.ancestor;
        },
        async names(directory) {
            return Array
                .from(content.keys())
                .filter(function inDirectory(target) {
                    return path.dirname(target) === directory;
                })
                .map(function filename(target) {
                    return path.basename(target);
                });
        },
        async inspect(target) {
            return { regular: input.regular, size: Buffer.byteLength(content.get(target) ?? '') };
        },
        async prepare(directory) {
            events.push(directory);
        },
        async remove(target) {
            removals += 1;
            if (removals === input.removalFailure) {
                throw failure;
            }
            content.delete(target);
        }
    };
    return {
        store: await openCalibrationReferenceStore({
            projectRoot: '/project',
            directory: 'references',
            maxBytes: input.maxBytes
        }, access),
        access,
        failure,
        events,
        seed(relative: string, value: string) {
            content.set(path.resolve('/project', relative), value);
        }
    };
}
