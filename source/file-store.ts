import { randomUUID } from 'node:crypto';
import { link, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type FileStore = {
    readonly create: (filePath: string, content: string) => Promise<void>;
    readonly read: (filePath: string) => Promise<string | null>;
    readonly write: (filePath: string, content: string) => Promise<void>;
};

async function cleanupFailedWrite(temporaryPath: string, error: unknown): Promise<void> {
    try {
        await rm(temporaryPath, { force: true });
    } catch (cleanupError: unknown) {
        throw new AggregateError([ error, cleanupError ], 'Runtime state write and cleanup failed.', {
            cause: cleanupError
        });
    }
}

async function publishFile(
    filePath: string,
    content: string,
    publish: (source: string, destination: string) => Promise<void>
): Promise<void> {
    await mkdir(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
    try {
        await writeFile(temporaryPath, content, { flag: 'wx' });
        await publish(temporaryPath, filePath);
    } catch (error: unknown) {
        await cleanupFailedWrite(temporaryPath, error);
        throw error;
    }
    await rm(temporaryPath, { force: true });
}

export function createNodeFileStore(): FileStore {
    return {
        async read(filePath) {
            try {
                return await readFile(filePath, 'utf8');
            } catch (error: unknown) {
                if (error instanceof Error && Reflect.get(error, 'code') === 'ENOENT') {
                    return null;
                }

                throw error;
            }
        },
        async create(filePath, content) {
            await publishFile(filePath, content, link);
        },
        async write(filePath, content) {
            await publishFile(filePath, content, rename);
        }
    };
}
