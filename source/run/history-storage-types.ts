import type { HistoryPolicy } from '../config/history-policy.ts';

export type HistoryStorage = {
    readonly beginRun: (id: string) => Promise<() => Promise<void>>;
    readonly list: (directory: string) => Promise<readonly string[]>;
    readonly read: (filePath: string) => Promise<string | null>;
    readonly write: (filePath: string, content: string) => Promise<void>;
    readonly withLock: <T>(operation: () => Promise<T>) => Promise<T>;
};

export type RuntimeStateStore = Pick<HistoryStorage, 'read' | 'write'>;
export type HistoryStorageFactory = (directory: string, policy: HistoryPolicy) => HistoryStorage;
