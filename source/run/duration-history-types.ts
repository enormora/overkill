import type { DurationHistoryInput, DurationHistoryObservation, WorkId, WorkUnit } from './run-types.ts';

export const durationHistoryIndexVersion = 2;

export type DurationHistoryIndex = {
    readonly entries: readonly DurationHistoryEntry[];
    readonly updatedAt: string;
    readonly version: typeof durationHistoryIndexVersion;
};

type DurationHistoryEntry = {
    readonly observations: readonly DurationHistoryObservation[];
    readonly work: WorkId;
};

export type DurationHistoryPlacement = {
    readonly facts: DurationHistoryInput | null;
    readonly unitDuration: ((unit: WorkUnit) => number) | null;
};

export type DurationHistoryStore = {
    readonly read: (filePath: string) => Promise<string | null>;
    readonly write: (filePath: string, content: string) => Promise<void>;
};
