import { randomUUID } from 'node:crypto';
import { link, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type FileStore = {
    readonly create: (filePath: string, content: string) => Promise<void>;
    readonly read: (filePath: string) => Promise<string | null>;
    readonly write: (filePath: string, content: string) => Promise<void>;
};

type DirectoryOptions = { readonly recursive: true; };
type ExclusiveWriteOptions = { readonly flag: 'wx'; };
type RemovalOptions = { readonly force: true; };
export type AtomicFileRuntime = {
    readonly identify: () => string;
    readonly directory: (directory: string, options: DirectoryOptions) => Promise<unknown>;
    readonly read: (file: string, encoding: 'utf8') => Promise<string>;
    readonly write: (file: string, content: string, options: ExclusiveWriteOptions) => Promise<void>;
    readonly link: (source: string, destination: string) => Promise<void>;
    readonly rename: (source: string, destination: string) => Promise<void>;
    readonly remove: (file: string, options: RemovalOptions) => Promise<void>;
};
async function cleanupFailedWrite(temporaryPath: string, error: unknown, runtime: AtomicFileRuntime): Promise<void> {
    try {
        await runtime.remove(temporaryPath, { force: true });
    } catch (cleanupError: unknown) {
        throw new AggregateError([ error, cleanupError ], 'Runtime state write and cleanup failed.', {
            cause: cleanupError
        });
    }
}

async function publishFile(
    filePath: string,
    content: string,
    publish: (source: string, destination: string) => Promise<void>,
    runtime: AtomicFileRuntime
): Promise<void> {
    await runtime.directory(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${runtime.identify()}.tmp`;
    try {
        await runtime.write(temporaryPath, content, { flag: 'wx' });
        await publish(temporaryPath, filePath);
    } catch (error: unknown) {
        await cleanupFailedWrite(temporaryPath, error, runtime);
        throw error;
    }
    await runtime.remove(temporaryPath, { force: true });
}

export function createAtomicFileStore(runtime: AtomicFileRuntime): FileStore {
    return {
        async read(filePath) {
            try {
                return await runtime.read(filePath, 'utf8');
            } catch (error: unknown) {
                if (error instanceof Error && Reflect.get(error, 'code') === 'ENOENT') {
                    return null;
                }

                throw error;
            }
        },
        async create(filePath, content) {
            await publishFile(filePath, content, runtime.link, runtime);
        },
        async write(filePath, content) {
            await publishFile(filePath, content, runtime.rename, runtime);
        }
    };
}

export function createNodeFileStore(): FileStore {
    return createAtomicFileStore({
        identify: randomUUID,
        directory: mkdir,
        read: readFile,
        write: writeFile,
        link,
        rename,
        remove: rm
    });
}
