import type { Except } from 'type-fest';
import type { NormalizedConfig } from '../config/types.ts';
import type { HistoryRepairResult } from './history-repair.ts';
import type { HistoryRunSummary as StoredSummary } from './compact-history-schema.ts';

export type HistoryOptions = {
    readonly projectRoot: string;
    readonly config: Pick<NormalizedConfig, 'history' | 'runtimeStateDir'>;
};
export type HistoryRunSummary = Except<StoredSummary, 'replayable'> & {
    readonly replay: 'available' | 'available-interrupted' | 'pruned' | 'unavailable';
};
export type HistoryPruneResult = {
    readonly diagnostics: readonly string[];
    readonly kind: 'applied' | 'dry-run';
    readonly paths: readonly string[];
    readonly removedSummaries: number;
    readonly removedCases: number;
    readonly removedWorkEntries: number;
};
export type HistoryClearResult = { readonly paths: readonly string[]; readonly diagnostics: readonly string[]; };
export type HistoryPruneRequest = { readonly dryRun: boolean; };
export type HistoryClearRequest = { readonly confirmed: true; };

export type History = {
    readonly list: () => Promise<readonly HistoryRunSummary[]>;
    readonly prune: (request: HistoryPruneRequest) => Promise<HistoryPruneResult>;
    readonly clear: (request: HistoryClearRequest) => Promise<HistoryClearResult>;
    readonly compact: () => Promise<HistoryRepairResult>;
};
