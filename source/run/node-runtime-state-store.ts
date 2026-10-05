import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { DurationHistoryStore } from './duration-history.ts';

export function createNodeRuntimeStateStore(): DurationHistoryStore {
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
        async write(filePath, content) {
            await mkdir(path.dirname(filePath), { recursive: true });
            const temporaryPath = `${filePath}.${randomUUID()}.tmp`;

            try {
                await writeFile(temporaryPath, content, { flag: 'wx' });
                await rename(temporaryPath, filePath);
            } catch (error: unknown) {
                try {
                    await rm(temporaryPath, { force: true });
                } catch (cleanupError: unknown) {
                    throw new AggregateError([ error, cleanupError ], 'Runtime state write and cleanup failed.', {
                        cause: cleanupError
                    });
                }
                throw error;
            }
        }
    };
}
