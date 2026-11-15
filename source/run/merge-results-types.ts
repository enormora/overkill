import type { NonEmptyReadonlyArray } from '../assertion-protocol/assertion-node-shape.ts';
import type { NormalizedConfig } from '../config/types.ts';
import type { MergedRunRecord as MergedRunRecordDefinition } from './run-record-types.ts';

type MergeFile = { readonly kind: 'file'; readonly path: string; };
type MergeDirectory = { readonly kind: 'directory'; readonly path: string; };
export type MergeResultsInput = MergeDirectory | MergeFile | { readonly kind: 'path'; readonly path: string; };
export type MergeResultsCommand = {
    readonly config: NormalizedConfig;
    readonly cwd: string;
    readonly inputs: NonEmptyReadonlyArray<MergeResultsInput>;
};
export type MergedRunRecord = MergedRunRecordDefinition;
