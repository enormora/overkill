import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { APIOptions } from 'typescript-beta/async';
import { compilerFileSystem } from './compiler-file-system.ts';

type PathObservation<Value> = {
    readonly path: string;
    readonly value: Value;
};
export type FrozenInputs = {
    readonly files: readonly PathObservation<string | null>[];
    readonly directories: readonly PathObservation<boolean>[];
    readonly probes: readonly PathObservation<boolean>[];
    readonly directoryEntries: readonly PathObservation<readonly string[]>[];
    readonly realPaths: readonly PathObservation<string>[];
};
export function sourceFingerprint(text: string): string {
    return createHash('sha256').update(text).digest('hex');
}

function observations<Value>(values: ReadonlyMap<string, Value>): readonly PathObservation<Value>[] {
    return Array
        .from(values, function observation([ path, value ]) {
            return { path, value };
        })
        .toSorted(function byPath(left, right) {
            return left.path.localeCompare(right.path);
        });
}

export type ProjectInputObservation = {
    readonly fs: NonNullable<APIOptions['fs']> & Pick<typeof compilerFileSystem, 'realpath'>;
    readonly snapshot: () => FrozenInputs;
};
export function observeProjectInputs(): ProjectInputObservation {
    const observed = {
        files: new Map<string, string | null>(),
        directories: new Map<string, boolean>(),
        probes: new Map<string, boolean>(),
        directoryEntries: new Map<string, readonly string[]>(),
        realPaths: new Map<string, string>()
    };
    return {
        fs: {
            readFile(path) {
                const text = compilerFileSystem.readFile(path);
                observed.files.set(path, text === undefined ? null : sourceFingerprint(text));
                return text;
            },
            fileExists(path) {
                const value = compilerFileSystem.fileExists(path);
                observed.probes.set(path, value);
                return value;
            },
            directoryExists(path) {
                const value = compilerFileSystem.directoryExists(path);
                observed.directories.set(path, value);
                return value;
            },
            getAccessibleEntries(path) {
                const names = compilerFileSystem.entries(path);
                observed.directoryEntries.set(path, names);
                return {
                    files: names.filter(function (name) {
                        return !compilerFileSystem.directoryExists(`${path}/${name}`);
                    }),
                    directories: names.filter(function (name) {
                        return compilerFileSystem.directoryExists(`${path}/${name}`);
                    }),
                    symlinks: undefined
                };
            },
            realpath(path: string) {
                const value = compilerFileSystem.realpath(path);
                observed.realPaths.set(path, value);
                return value;
            },
            stat: compilerFileSystem.stat,
            writeFile() {
                throw new Error('Type-test analysis cannot emit files.');
            },
            removeFile() {
                throw new Error('Type-test analysis cannot remove files.');
            }
        },
        snapshot() {
            return {
                files: observations(observed.files),
                directories: observations(observed.directories),
                probes: observations(observed.probes),
                directoryEntries: observations(observed.directoryEntries),
                realPaths: observations(observed.realPaths)
            };
        }
    };
}

export function verifyProjectInputs(inputs: FrozenInputs): void {
    const current = {
        files(path: string) {
            const text = compilerFileSystem.readFile(path);
            return text === undefined ? null : sourceFingerprint(text);
        },
        directories: compilerFileSystem.directoryExists,
        probes(path: string) {
            return compilerFileSystem.fileExists(path);
        },
        directoryEntries: compilerFileSystem.entries,
        realPaths(path: string) {
            return compilerFileSystem.realpath(path);
        }
    };
    const names = [ 'files', 'directories', 'probes', 'directoryEntries', 'realPaths' ] as const;
    for (const name of names) {
        const values = inputs[name];
        for (const observation of values) {
            if (!isDeepStrictEqual(current[name](observation.path), observation.value)) {
                throw new Error(`Type-test input changed after collection: ${observation.path}`);
            }
        }
    }
}
