import path from 'node:path';
import { openOrdinaryBaselineStore, type OrdinaryBaselineAccess } from '../run/baseline-store.ts';
import { createBaselineStorage, type BaselineStorage } from '../run/baseline-storage.ts';

export const ordinaryStorageInput = { projectRoot: '/project', directory: 'baselines', maxBytes: 65_536 };
type OrdinaryStorageScenario = {
    readonly ancestor: string;
    readonly link: boolean;
    readonly file: boolean;
    readonly missingRead: boolean;
};
export const ordinaryStorageScenario: OrdinaryStorageScenario = {
    ancestor: '/project',
    link: false,
    file: true,
    missingRead: false
};
type OrdinaryStorageFixture = {
    readonly access: OrdinaryBaselineAccess;
    readonly files: ReadonlyMap<string, string>;
    readonly events: readonly string[];
    readonly storage: BaselineStorage;
    readonly store: Awaited<ReturnType<typeof openOrdinaryBaselineStore>>;
    readonly seed: (file: string, content: string) => void;
};
export async function ordinaryBaselineStorage(scenario: OrdinaryStorageScenario): Promise<OrdinaryStorageFixture> {
    const files = new Map<string, string>();
    const events: string[] = [];
    const access: OrdinaryBaselineAccess = {
        files: {
            async read(file) {
                return scenario.missingRead ? null : files.get(file) ?? null;
            },
            async write(file, content) {
                files.set(file, content);
            },
            async create(file, content) {
                if (files.has(file)) {
                    throw new Error('already exists');
                }
                files.set(file, content);
            }
        },
        async canonical(file) {
            return file;
        },
        async ancestor() {
            return scenario.ancestor;
        },
        async inspect(file) {
            return files.has(file) || scenario.link
                ? { file: scenario.file, link: scenario.link, size: Buffer.byteLength(files.get(file) ?? '') }
                : null;
        },
        async names(directory) {
            return Array
                .from(files.keys())
                .filter(function (file) {
                    return path.dirname(file) === directory;
                })
                .map(function (file) {
                    return path.basename(file);
                });
        },
        async prepare() {
            events.push('prepare');
        },
        async remove(file) {
            files.delete(file);
        },
        async lock() {
            events.push('lock');
            return async function () {
                events.push('release');
            };
        }
    };
    const storage = createBaselineStorage({
        root: '/project',
        directory: '/project/baselines',
        maxBytes: ordinaryStorageInput.maxBytes
    }, access);
    return {
        files,
        events,
        access,
        storage,
        store: await openOrdinaryBaselineStore(ordinaryStorageInput, access),
        seed(file, content) {
            files.set(file, content);
        }
    };
}
