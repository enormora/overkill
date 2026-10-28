import { createHash } from 'node:crypto';
import { xoroshiro128plusFromState } from 'pure-rand/generator/xoroshiro128plus';
import type { RandomGenerator } from 'pure-rand/types/RandomGenerator';

const stateWordCount = 4;

function seededGenerator(identity: readonly unknown[]): RandomGenerator {
    const digest = createHash('sha256').update(JSON.stringify(identity)).digest();
    const state = Array.from({ length: stateWordCount }, function stateWord(_value, index) {
        return digest.readInt32BE(index * Int32Array.BYTES_PER_ELEMENT);
    });
    const allZero = state.every(function zeroWord(word) {
        return word === 0;
    });
    const initializedState = allZero ? [ 1, 0, 0, 0 ] : state;
    return xoroshiro128plusFromState(initializedState);
}

export function createRandomStream(seed: bigint): RandomGenerator {
    return seededGenerator([ 'case-random-v1', seed.toString() ]);
}

export function splitRandomStream(generator: RandomGenerator): readonly [RandomGenerator, RandomGenerator] {
    const state = generator.getState();
    generator.next();
    return [
        seededGenerator([ 'case-random-split-v1', state, 'first' ]),
        seededGenerator([ 'case-random-split-v1', state, 'second' ])
    ];
}
