import type { NonEmptyReadonlyArray } from '../assertion-protocol/assertion-node-shape.ts';
import type { NormalizedConfig } from '../config/types.ts';
import type { WorkId } from '../engine/identity.ts';
import type { RunFacts } from './run-types.ts';
import type { ResolvedRuntime, RunRecordResult, RunRecordVersions } from './run-record-types.ts';

type MergeFile = { readonly kind: 'file'; readonly path: string; };
type MergeDirectory = { readonly kind: 'directory'; readonly path: string; };
export type MergeResultsInput = MergeDirectory | MergeFile;
export type MergeResultsCommand = {
    readonly config: NormalizedConfig;
    readonly cwd: string;
    readonly inputs: NonEmptyReadonlyArray<MergeResultsInput>;
};
export type MergedRunRecord = {
    readonly id: string;
    readonly kind: 'merged';
    readonly facts: RunFacts;
    readonly identities: readonly WorkId[];
    readonly lineage: NonEmptyReadonlyArray<{ readonly id: string; readonly path: string; }>;
    readonly runtime: NonEmptyReadonlyArray<ResolvedRuntime | null>;
    readonly versions: Pick<RunRecordVersions, 'engine' | 'packages'>;
    readonly startedAt: string;
    readonly result: RunRecordResult;
};
