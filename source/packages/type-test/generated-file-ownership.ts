import { lstat, open, readFile, unlink } from 'node:fs/promises';

export type OwnedFile = {
    readonly path: string;
    readonly text: string;
    readonly device: number;
    readonly inode: number;
};
async function removeOwnedFile(file: OwnedFile): Promise<void> {
    const stats = await lstat(file.path);
    const sameIdentity = stats.isFile() && stats.dev === file.device && stats.ino === file.inode;
    if (!sameIdentity || await readFile(file.path, 'utf8') !== file.text) {
        throw new Error(`Generated input changed; preserving file: ${file.path}`);
    }
    await unlink(file.path);
}
export type GeneratedFileOwnership = {
    readonly write: (path: string, text: string) => Promise<void>;
    readonly cleanup: () => Promise<void>;
};
export function createGeneratedFileOwnership(): GeneratedFileOwnership {
    const files = new Map<string, OwnedFile>();
    return {
        async write(path: string, text: string): Promise<void> {
            await using handle = await open(path, 'wx');
            try {
                const stats = await handle.stat();
                files.set(path, { path, text, device: stats.dev, inode: stats.ino });
                await handle.writeFile(text);
            } catch (error: unknown) {
                const file = files.get(path);
                if (file !== undefined) {
                    files.set(path, { ...file, text: await readFile(path, 'utf8') });
                }
                throw error;
            }
        },

        async cleanup(): Promise<void> {
            const results = await Promise.allSettled(Array.from(files.values(), removeOwnedFile));
            const failures = results.filter(function failed(result) {
                return result.status === 'rejected';
            });
            const errors = failures
                .map(function reason(result) {
                    return result.reason as unknown;
                })
                .filter(function present(error) {
                    return !(error instanceof Error) || Reflect.get(error, 'code') !== 'ENOENT';
                });
            if (errors.length > 0) {
                throw new AggregateError(errors, 'Generated input cleanup failed.');
            }
        }
    };
}
