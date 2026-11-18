import path from 'node:path';
import type { PropertyCorpusAccess, CorpusDirectoryEntry, PropertyCorpusRead } from '../run/property-corpus-storage.ts';
import { propertyCorpusPolicySchema } from '../config/property-corpus.ts';

type CorpusStorageScenario = {
    readonly readFailure: Error | null;
    readonly writeFailure: Error | null;
    readonly lockFailure: Error | null;
};
export const corpusStorageScenario: CorpusStorageScenario = {
    readFailure: null,
    writeFailure: null,
    lockFailure: null
};
type CorpusStorageFixture = {
    readonly access: PropertyCorpusAccess;
    readonly input: PropertyCorpusRead;
    readonly events: readonly string[];
    readonly files: ReadonlyMap<string, string>;
    readonly seed: (target: string, content: string) => void;
};
function corpusChildren(files: ReadonlyMap<string, string>, target: string): readonly CorpusDirectoryEntry[] {
    const children = new Map<string, CorpusDirectoryEntry>();
    for (const file of files.keys()) {
        const relative = path.relative(target, file);
        const [ name ] = relative.split(path.sep);
        if (!relative.startsWith('../') && relative !== '' && name !== undefined) {
            children.set(name, { name, kind: relative.includes(path.sep) ? 'directory' : 'file' });
        }
    }
    return Array.from(children.values());
}
export function propertyCorpusStorage(input: CorpusStorageScenario): CorpusStorageFixture {
    const files = new Map<string, string>();
    const events: string[] = [];
    return {
        files,
        events,
        seed(target, content) {
            files.set(target, content);
        },
        input: {
            projectRoot: '/project',
            directory: '/state',
            profile: 'unit',
            policy: propertyCorpusPolicySchema.parse({ checkedIn: [] })
        },
        access: {
            files: {
                async read(target) {
                    if (input.readFailure !== null) {
                        throw input.readFailure;
                    }
                    return files.get(target) ?? null;
                },
                async write(target, content) {
                    if (input.writeFailure !== null) {
                        throw input.writeFailure;
                    }
                    events.push('write');
                    files.set(target, content);
                }
            },
            async directory(target) {
                return !files.has(target);
            },
            async children(target) {
                return corpusChildren(files, target);
            },
            async prepare() {
                events.push('prepare');
            },
            async lock() {
                events.push('lock');
                if (input.lockFailure !== null) {
                    throw input.lockFailure;
                }
                return async function release() {
                    events.push('release');
                };
            },
            now() {
                return '2026-10-30T00:00:00.000Z';
            }
        }
    };
}
