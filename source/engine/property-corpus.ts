import type { PropertyWitnessFile } from './witness-file.ts';

type PropertyCorpusEntries = {
    readonly checkedIn: readonly PropertyWitnessFile[];
    readonly localCache: readonly PropertyWitnessFile[];
    readonly diagnostics: readonly { readonly path: string; readonly reason: string; }[];
};
type WitnessReplayCorpus = PropertyCorpusEntries & { readonly replay: PropertyWitnessFile; };
export type PropertyCorpusSnapshot = PropertyCorpusEntries | WitnessReplayCorpus;
function hasReplay(snapshot: PropertyCorpusSnapshot): snapshot is WitnessReplayCorpus {
    return Object.hasOwn(snapshot, 'replay');
}
export function propertyReplayWitness(snapshot: PropertyCorpusSnapshot): PropertyWitnessFile | null {
    return hasReplay(snapshot) ? snapshot.replay : null;
}

export const emptyPropertyCorpus: PropertyCorpusSnapshot = { checkedIn: [], localCache: [], diagnostics: [] };
