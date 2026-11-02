import type { PropertyWitnessFile } from '../engine/property-corpus.ts';

const failingInput = 42;

export const propertyCorpusEntry: PropertyWitnessFile = {
    version: 1,
    kind: 'property',
    producedBy: { library: '@overkill-dev/property', libraryVersion: 'test' },
    case: { file: 'laws.ts', suite: [], title: 'law', params: null },
    runtimes: [],
    target: { kind: 'property-value' },
    seed: '42',
    failureIdentity: null,
    shrinkPath: null,
    counterexample: {
        format: { name: 'graph', version: 1 },
        codec: { name: 'standard', version: 1 },
        payload: [ failingInput ]
    }
};
