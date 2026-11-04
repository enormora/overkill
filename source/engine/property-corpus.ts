import type { PropertyWitnessFile } from './witness-file.ts';

export type PropertyCorpusSnapshot = {
    readonly checkedIn: readonly PropertyWitnessFile[];
    readonly localCache: readonly PropertyWitnessFile[];
    readonly diagnostics: readonly { readonly path: string; readonly reason: string; }[];
};
export const emptyPropertyCorpus: PropertyCorpusSnapshot = { checkedIn: [], localCache: [], diagnostics: [] };
