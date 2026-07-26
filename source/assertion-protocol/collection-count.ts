import { isPlainObject, ownKeys } from './partial-matching.ts';

export type CountedCollection = {
    readonly count: number;
    readonly supported: boolean;
};

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

type IteratorProvider = {
    readonly [Symbol.iterator]: () => Iterator<unknown>;
};

function hasIteratorProvider(value: Record<string, unknown>): value is IteratorProvider {
    return typeof Reflect.get(value, Symbol.iterator) === 'function';
}

function iterableItems(value: unknown): Iterator<unknown> | null {
    if (!isObject(value) || !hasIteratorProvider(value)) {
        return null;
    }

    return value[Symbol.iterator]();
}

function countIterator(iterator: Iterator<unknown>, limit: number): number {
    let count = 0;
    let item = iterator.next();

    while (item.done !== true && count < limit) {
        count += 1;
        item = iterator.next();
    }

    return count;
}

function knownCollectionCount(value: unknown): number | null {
    if (typeof value === 'string' || Array.isArray(value)) {
        return value.length;
    }

    if (value instanceof Map || value instanceof Set) {
        return value.size;
    }

    return isPlainObject(value) ? ownKeys(value).length : null;
}

export function collectionCount(value: unknown, limit: number): CountedCollection {
    const knownCount = knownCollectionCount(value);

    if (knownCount !== null) {
        return { count: knownCount, supported: true };
    }

    const iterator = iterableItems(value);

    return iterator === null
        ? { count: 0, supported: false }
        : { count: countIterator(iterator, limit), supported: true };
}
