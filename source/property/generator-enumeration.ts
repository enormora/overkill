import { isDeepStrictEqual } from 'node:util';
import type { GeneratorContext } from './generator-backend.ts';
import {
    readGeneratorEnumeration,
    type EnumerationContext,
    type EnumerationSource,
    type Generator as PropertyGenerator
} from './generator.ts';
import type { InputRecipe } from './generator-edges.ts';

const bigintUnit = 1n;
const bigintBase = 2n;
const doubleSignBits = 63n;
const doubleSign = bigintBase ** doubleSignBits;
const doubleMask = doubleSign * bigintBase - bigintUnit;

const discoveryLimit = new Error('Exhaustive discovery limit reached.');

export function* integerDomain(min: bigint, max: bigint): Generator<bigint> {
    for (let value = min; value <= max; value += bigintUnit) {
        yield value;
    }
}

export function scalarDomain<Value>(values: () => Iterable<Value>): EnumerationSource<Value> {
    return function* enumerate(context) {
        for (const value of values()) {
            context.discover();
            yield function () {
                return value;
            };
        }
    };
}

function reconstructProduct<Value>(recipes: readonly InputRecipe<Value>[], context: GeneratorContext): Value[] {
    return recipes.map(function reconstruct(recipe) {
        context.consumeWork();
        return recipe();
    });
}

export function productDomain<Component, Value>(
    sources: readonly EnumerationSource<Component>[],
    build: (values: readonly Component[]) => Value
): EnumerationSource<Value> {
    return function* enumerate(context) {
        function* visit(index: number, recipes: readonly InputRecipe<Component>[]): Generator<InputRecipe<Value>> {
            context.consumeWork();
            if (index === sources.length) {
                yield function () {
                    return build(reconstructProduct(recipes, context));
                };
                return;
            }
            const source = sources[index];
            if (source === undefined) {
                throw new Error('Missing product component.');
            }
            const inputs = source(context);
            for (const recipe of inputs) {
                yield* visit(index + 1, [ ...recipes, recipe ]);
            }
        }
        yield* visit(0, []);
    };
}

type DomainDiscovery = { readonly context: EnumerationContext; readonly finish: () => void; };

function discoveryContext(
    context: GeneratorContext,
    limit: number
): DomainDiscovery {
    let candidates = 0;
    let active = true;
    return {
        context: {
            ...context,
            discover() {
                context.consumeWork();
                if (active) {
                    candidates += 1;
                }
                if (candidates > limit) {
                    throw discoveryLimit;
                }
            }
        },
        finish() {
            active = false;
            candidates = 0;
        }
    };
}

type CatalogEntry<Value> = { readonly input: InputRecipe<Value>; readonly value: Value; };
type DomainCatalog<Value> = {
    readonly add: (input: InputRecipe<Value>) => void;
    readonly inputs: () => readonly InputRecipe<Value>[];
};

function domainCatalog<Value>(
    context: GeneratorContext,
    limit: number
): DomainCatalog<Value> {
    const entries: CatalogEntry<Value>[] = [];
    const scalars = new Set<unknown>();
    const negativeZero = Symbol('negative zero');
    return {
        add(input: InputRecipe<Value>) {
            context.consumeWork();
            const value = input();
            const key = Object.is(value, -0) ? negativeZero : value;
            const duplicate = typeof value === 'object'
                ? entries.some(function equal(entry) {
                    context.consumeWork();
                    return isDeepStrictEqual(entry.value, value);
                })
                : scalars.has(key);
            if (duplicate) {
                return;
            }
            if (entries.length === limit) {
                throw discoveryLimit;
            }
            scalars.add(key);
            entries.push({ input, value });
        },
        inputs() {
            return entries.map(function (entry) {
                return entry.input;
            });
        }
    };
}
function collectDomain<Value>(
    inputs: Iterable<InputRecipe<Value>>,
    context: GeneratorContext,
    limit: number
): readonly InputRecipe<Value>[] {
    const catalog = domainCatalog<Value>(context, limit);
    for (const input of inputs) {
        catalog.add(input);
    }
    return catalog.inputs();
}

export function enumerateDomain<Value>(
    generator: PropertyGenerator<Value>,
    context: GeneratorContext,
    limit: number
): readonly InputRecipe<Value>[] | null {
    if (limit === 0) {
        return null;
    }
    const discovery = discoveryContext(context, limit);
    const inputs = readGeneratorEnumeration(generator)(discovery.context);
    try {
        return collectDomain(inputs, context, limit);
    } catch (error: unknown) {
        if (error === discoveryLimit) {
            return null;
        }
        throw error;
    } finally {
        discovery.finish();
    }
}

export function* doubleDomain(min: number, max: number): Generator<number> {
    const storage = new DataView(new ArrayBuffer(Float64Array.BYTES_PER_ELEMENT));
    const sign = doubleSign;
    const mask = doubleMask;
    function ordinal(value: number): bigint {
        storage.setFloat64(0, value);
        const bits = storage.getBigUint64(0);
        return bits < sign ? bits + sign : mask - bits;
    }
    const start = ordinal(min === 0 ? -0 : min);
    const end = ordinal(max === 0 ? 0 : max);
    for (const key of integerDomain(start, end)) {
        storage.setBigUint64(0, key < sign ? mask - key : key - sign);
        yield storage.getFloat64(0);
    }
}
