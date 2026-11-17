import type { currentRunRecordVersion } from './run/run-record-format.ts';

export type RunRecordHeader<Kind extends 'merged' | 'mutation' | 'single'> = {
    readonly version: typeof currentRunRecordVersion;
    readonly kind: Kind;
    readonly id: string;
    readonly startedAt: string;
    readonly status: 'completed' | 'interrupted' | 'started';
    readonly detail: 'compact' | 'detailed';
};
