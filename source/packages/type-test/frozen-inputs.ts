import { hash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { APIOptions } from 'typescript-beta/async';
import { parseAdapterFacts } from '../../config/adapter-facts.ts';
import { compilerFileSystem } from './compiler-file-system.ts';

type PathObservation<Value> = {
    readonly path: string;
    readonly value: Value;
};
type StatObservation = { readonly mode: number; readonly size: number; readonly mtime: number; };
type DirectoryEntries = { readonly files: readonly string[]; readonly directories: readonly string[]; };

export type FrozenInputs = {
    readonly files: readonly PathObservation<string | null>[];
    readonly directories: readonly PathObservation<boolean>[];
    readonly probes: readonly PathObservation<boolean>[];
    readonly directoryEntries: readonly PathObservation<DirectoryEntries>[];
    readonly stats: readonly PathObservation<StatObservation | null>[];
    readonly realPaths: readonly PathObservation<string>[];
};
export function sourceFingerprint(text: string): string {
    return hash('sha256', text);
}

function observations<Value>(values: ReadonlyMap<string, Value>): readonly PathObservation<Value>[] {
    return Object.freeze(
        Array.from(values, function observation([ path, value ]) {
            return Object.freeze({ path, value });
        }).toSorted(function byPath(left, right) {
            return left.path.localeCompare(right.path);
        })
    );
}

export type ProjectInputObservation = {
    readonly fs: NonNullable<APIOptions['fs']> & Pick<typeof compilerFileSystem, 'readFile' | 'realpath'>;
    readonly snapshot: () => FrozenInputs;
};
function accessibleEntries(path: string): DirectoryEntries {
    const files: string[] = [];
    const directories: string[] = [];
    for (const name of compilerFileSystem.entries(path)) {
        (compilerFileSystem.directoryExists(`${path}/${name}`) ? directories : files).push(name);
    }
    return Object.freeze({ files: Object.freeze(files), directories: Object.freeze(directories) });
}

function statObservation(stat: ReturnType<typeof compilerFileSystem.stat>): StatObservation | null {
    return stat === undefined
        ? null
        : Object.freeze({ mode: stat.mode, size: stat.size, mtime: stat.mtime.getTime() });
}

type ObservedValues<Value> = {
    readonly record: (path: string, value: Value) => void;
    readonly snapshot: () => readonly PathObservation<Value>[];
};

export function observeProjectInputs(): ProjectInputObservation {
    let drift: Error | null = null;
    let inputs: FrozenInputs | null = null;
    function observe<Value>(): ObservedValues<Value> {
        const values = new Map<string, Value>();
        let captured: readonly PathObservation<Value>[] | null = null;
        return {
            record(path: string, value: Value) {
                if (!values.has(path)) {
                    values.set(path, value);
                    captured = null;
                    inputs = null;
                } else if (!isDeepStrictEqual(values.get(path), value)) {
                    drift = drift ?? new Error(`Type-test input changed after collection: ${path}`);
                }
            },
            snapshot() {
                captured = captured ?? observations(values);
                return captured;
            }
        };
    }
    const observed = {
        files: observe<string | null>(),
        directories: observe<boolean>(),
        probes: observe<boolean>(),
        directoryEntries: observe<DirectoryEntries>(),
        stats: observe<StatObservation | null>(),
        realPaths: observe<string>()
    };
    return {
        fs: {
            readFile(path: string) {
                const text = compilerFileSystem.readFile(path);
                observed.files.record(path, text === undefined ? null : sourceFingerprint(text));
                return text;
            },
            fileExists(path) {
                const value = compilerFileSystem.fileExists(path);
                observed.probes.record(path, value);
                return value;
            },
            directoryExists(path) {
                const value = compilerFileSystem.directoryExists(path);
                observed.directories.record(path, value);
                return value;
            },
            getAccessibleEntries(path) {
                const entries = accessibleEntries(path);
                observed.directoryEntries.record(path, entries);
                return {
                    files: Array.from(entries.files),
                    directories: Array.from(entries.directories),
                    symlinks: undefined
                };
            },
            realpath(path: string) {
                const value = compilerFileSystem.realpath(path);
                observed.realPaths.record(path, value);
                return value;
            },
            stat(path) {
                const value = compilerFileSystem.stat(path);
                observed.stats.record(path, statObservation(value));
                return value;
            },
            writeFile() {
                throw new Error('Type-test analysis cannot emit files.');
            },
            removeFile() {
                throw new Error('Type-test analysis cannot remove files.');
            }
        },
        snapshot() {
            if (drift !== null) {
                throw drift;
            }
            inputs = inputs ?? Object.freeze({
                files: observed.files.snapshot(),
                directories: observed.directories.snapshot(),
                probes: observed.probes.snapshot(),
                directoryEntries: observed.directoryEntries.snapshot(),
                stats: observed.stats.snapshot(),
                realPaths: observed.realPaths.snapshot()
            });
            return inputs;
        }
    };
}

const recordedInputs = new WeakMap<FrozenInputs, ReturnType<typeof parseAdapterFacts>>();

export function frozenInputFacts(inputs: FrozenInputs): ReturnType<typeof parseAdapterFacts> {
    const existing = recordedInputs.get(inputs);
    if (existing !== undefined) {
        return existing;
    }
    const facts = parseAdapterFacts(inputs);
    recordedInputs.set(inputs, facts);
    return facts;
}

export function verifyProjectInputs(inputs: FrozenInputs, signal: AbortSignal): void {
    const verifiedFiles = new Set<string>();
    const current = {
        files(path: string) {
            const text = compilerFileSystem.readFile(path);
            if (text === undefined) {
                return null;
            }
            verifiedFiles.add(path);
            return sourceFingerprint(text);
        },
        directories: compilerFileSystem.directoryExists,
        probes(path: string) {
            return verifiedFiles.has(path) || compilerFileSystem.fileExists(path);
        },
        directoryEntries: accessibleEntries,
        stats(path: string) {
            return statObservation(compilerFileSystem.stat(path));
        },
        realPaths(path: string) {
            return compilerFileSystem.realpath(path);
        }
    };
    const names = [ 'files', 'directories', 'probes', 'directoryEntries', 'stats', 'realPaths' ] as const;
    for (const name of names) {
        const values = inputs[name];
        for (const observation of values) {
            signal.throwIfAborted();
            if (!isDeepStrictEqual(current[name](observation.path), observation.value)) {
                throw new Error(`Type-test input changed after collection: ${observation.path}`);
            }
        }
    }
}
