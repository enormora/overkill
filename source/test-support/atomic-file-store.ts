import { testDouble } from '../packages/doubles/doubles.entry-point.ts';
import { createAtomicFileStore, type AtomicFileRuntime, type FileStore } from '../file-store.ts';

export type FileStoreFaults = {
    readonly directory: Error | null;
    readonly write: Error | null;
    readonly publish: Error | null;
    readonly cleanup: Error | null;
    readonly read: unknown;
};
export const reliableFileStore: FileStoreFaults = {
    directory: null,
    write: null,
    publish: null,
    cleanup: null,
    read: null
};
type AtomicFileFixture = {
    readonly store: FileStore;
    readonly files: ReadonlyMap<string, string>;
    readonly events: readonly string[];
};
type AtomicFileState = {
    readonly faults: FileStoreFaults;
    readonly files: ReadonlyMap<string, string>;
    readonly record: (event: string) => void;
    readonly put: (file: string, content: string) => void;
    readonly remove: (file: string) => void;
};
function assertWrite(failure: Error | null): void {
    if (failure !== null) {
        throw failure;
    }
}
function missing(file: string): Error {
    return Object.assign(new Error(`Missing ${file}`), { code: 'ENOENT' });
}
function publication(state: AtomicFileState, source: string, destination: string, replace: boolean): void {
    state.record(`${replace ? 'rename' : 'link'}:${source}:${destination}`);
    assertWrite(state.faults.publish);
    if (!replace && state.files.has(destination)) {
        throw Object.assign(new Error('Already exists.'), { code: 'EEXIST' });
    }
    const content = state.files.get(source);
    if (content === undefined) {
        throw missing(source);
    }
    state.put(destination, content);
    if (replace) {
        state.remove(source);
    }
}
function fileRuntime(state: AtomicFileState): AtomicFileRuntime {
    let sequence = 0;
    return {
        identify() {
            sequence += 1;
            return `temporary-${sequence}`;
        },
        async directory(directory, options) {
            state.record(`directory:${directory}:${options.recursive}`);
            assertWrite(state.faults.directory);
        },
        async read(file, encoding) {
            state.record(`read:${file}:${encoding}`);
            if (state.faults.read !== null) {
                testDouble.throws<() => void>(state.faults.read)();
            }
            const content = state.files.get(file);
            if (content === undefined) {
                throw missing(file);
            }
            return content;
        },
        async write(file, content, options) {
            state.record(`write:${file}:${options.flag}`);
            assertWrite(state.faults.write);
            if (state.files.has(file)) {
                throw new Error('Temporary file collision.');
            }
            state.put(file, content);
        },
        async link(source, destination) {
            publication(state, source, destination, false);
        },
        async rename(source, destination) {
            publication(state, source, destination, true);
        },
        async remove(file, options) {
            state.record(`remove:${file}:${options.force}`);
            assertWrite(state.faults.cleanup);
            state.remove(file);
        }
    };
}
export function atomicFileStore(
    faults: FileStoreFaults,
    initial: readonly (readonly [string, string])[]
): AtomicFileFixture {
    const files = new Map(initial);
    const events: string[] = [];
    const state: AtomicFileState = {
        faults,
        files,
        record(event) {
            events.push(event);
        },
        put(file, content) {
            files.set(file, content);
        },
        remove(file) {
            files.delete(file);
        }
    };
    return { store: createAtomicFileStore(fileRuntime(state)), files, events };
}
