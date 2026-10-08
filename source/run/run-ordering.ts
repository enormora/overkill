import { uniformInt } from 'pure-rand/distribution/uniformInt';
import { xoroshiro128plus } from 'pure-rand/generator/xoroshiro128plus';
import type { NonEmptyReadonlyArray } from '../assertion-protocol/assertion-node-shape.ts';
import type { RunOrder } from '../config/types.ts';
import type { RunSeed } from './run-types.ts';

const randomSeedRange = 4_294_967_296n;

function resolvedSeed(seed: RunSeed): bigint {
    if (seed.value === null) {
        throw new Error('Seeded ordering requires a resolved run seed.');
    }

    return seed.value;
}

function generatorSeed(seed: bigint): number {
    const normalizedSeed = (seed % randomSeedRange + randomSeedRange) % randomSeedRange;

    return Number(normalizedSeed);
}

function arrayEntry<Value>(values: readonly Value[], index: number): Value {
    const value = values[index];

    if (value === undefined) {
        throw new Error('Seeded ordering selected an invalid case index.');
    }

    return value;
}

function seededOrder<Value>(values: NonEmptyReadonlyArray<Value>, seed: bigint): NonEmptyReadonlyArray<Value>;
function seededOrder<Value>(values: readonly Value[], seed: bigint): readonly Value[];
function seededOrder<Value>(values: readonly Value[], seed: bigint): readonly Value[] {
    const random = xoroshiro128plus(generatorSeed(seed));
    const ordered = Array.from(values);

    for (let index = ordered.length - 1; index > 0; index -= 1) {
        const swapIndex = uniformInt(random, 0, index);
        const leftValue = arrayEntry(ordered, index);
        const rightValue = arrayEntry(ordered, swapIndex);

        ordered[index] = rightValue;
        ordered[swapIndex] = leftValue;
    }

    return ordered;
}

export function orderedRunItems<Item>(items: readonly Item[], order: RunOrder, seed: RunSeed): readonly Item[] {
    return order === 'seeded' ? seededOrder(items, resolvedSeed(seed)) : items;
}
