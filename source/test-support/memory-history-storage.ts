import type { HistoryStorage } from '../run/history-storage-types.ts';

export function createMemoryHistoryStorage(): HistoryStorage {
    const files = new Map<string, string>();
    let previous: Promise<undefined> = Promise.resolve(undefined);
    return {
        async read(filePath) {
            return files.get(filePath) ?? null;
        },
        async write(filePath, content) {
            files.set(filePath, content);
        },
        async list(directory) {
            return Array.from(files.keys()).filter(function withinDirectory(filePath) {
                return filePath.startsWith(`${directory}/`);
            });
        },
        async withLock(operation) {
            const finished = Promise.withResolvers<undefined>();
            const current = previous;
            previous = finished.promise;
            try {
                await current;
                return await operation();
            } finally {
                finished.resolve(undefined);
            }
        }
    };
}
