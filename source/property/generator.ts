import type { Arbitrary } from 'fast-check';
import { DeferredArbitrary, type GeneratorContext } from './generator-backend.ts';
import { edgeAt, indexedEdges, type GeneratorEdgeSource } from './generator-edges.ts';
import type { PropertyInputCodec } from './property-codec.ts';

const generatorBrand = Symbol.for('@overkill-dev/property/Generator');
const generatorDomain = Symbol.for('@overkill-dev/property/Generator/domain/v1');
const generatorEdges = Symbol.for('@overkill-dev/property/Generator/edges/v1');
const generatorCodec = Symbol.for('@overkill-dev/property/Generator/codec/v1');

export type Generator<Value> = {
    readonly [generatorBrand]: true;
    readonly map: <Output>(transform: (value: Value) => Output) => Generator<Output>;
    readonly flatMap: <Output>(transform: (value: Value) => Generator<Output>) => Generator<Output>;
    readonly filter: (predicate: (value: Value) => boolean) => Generator<Value>;
    readonly withCodec: (codec: PropertyInputCodec<Value>) => Generator<Value>;
};

type GeneratorState<Value> = {
    readonly [generatorEdges]: GeneratorEdgeSource<Value>;
    readonly [generatorDomain]: (context: GeneratorContext) => Arbitrary<Value>;
    readonly [generatorCodec]: PropertyInputCodec<Value> | null;
};

function hasGeneratorState<Value>(value: unknown): value is Generator<Value> & GeneratorState<Value> {
    return typeof value === 'object' && value !== null &&
        Reflect.get(value, generatorBrand) === true &&
        [ generatorDomain, generatorEdges ].every(function hasResolver(key) {
            return typeof Reflect.get(value, key) === 'function';
        }) &&
        Object.hasOwn(value, generatorCodec) &&
        [ 'map', 'flatMap', 'filter', 'withCodec' ].every(function hasGeneratorMethod(method) {
            return typeof Reflect.get(value, method) === 'function';
        });
}

export const isGenerator: (value: unknown) => value is Generator<unknown> = hasGeneratorState;

export function ensureGenerator(value: unknown): void {
    if (!isGenerator(value)) {
        throw new TypeError('Property requires an Overkill generator.');
    }
}

export function prepareGenerator<Input>(generator: Generator<Input>, context: GeneratorContext): Arbitrary<Input> {
    if (!hasGeneratorState<Input>(generator)) {
        throw new TypeError('Property requires an Overkill generator.');
    }
    return new DeferredArbitrary(function resolveDomain() {
        return generator[generatorDomain](context);
    }, context);
}

export function readGeneratorCodec<Input>(generator: Generator<Input>): PropertyInputCodec<Input> | null {
    if (!hasGeneratorState<Input>(generator)) {
        throw new TypeError('Property requires an Overkill generator.');
    }
    return generator[generatorCodec];
}

export function readGeneratorEdges<Input>(generator: Generator<Input>): GeneratorEdgeSource<Input> {
    if (!hasGeneratorState<Input>(generator)) {
        throw new TypeError('Property requires an Overkill generator.');
    }
    return generator[generatorEdges];
}

function ensureCallback(callback: unknown): void {
    if (typeof callback !== 'function') {
        throw new TypeError('Generator composition requires a callback.');
    }
}

export function createGenerator<Value>(
    resolve: (context: GeneratorContext) => Arbitrary<Value>,
    codec: PropertyInputCodec<Value> | null,
    edges: GeneratorEdgeSource<Value>
): Generator<Value> {
    const generator: Generator<Value> & GeneratorState<Value> = {
        [generatorBrand]: true,
        [generatorDomain]: resolve,
        [generatorEdges]: edges,
        [generatorCodec]: codec,
        map<Output>(transform: (value: Value) => Output): Generator<Output> {
            ensureCallback(transform);
            return createGenerator(
                function (context) {
                    return prepareGenerator(generator, context).map(function transformValue(value) {
                        context.consumeWork();
                        return transform(value);
                    });
                },
                null,
                function* mappedEdges(context) {
                    for (const source of edges(context)) {
                        yield function reconstructMappedEdge() {
                            context.consumeWork();
                            return transform(source());
                        };
                    }
                }
            );
        },
        flatMap<Output>(transform: (value: Value) => Generator<Output>): Generator<Output> {
            ensureCallback(transform);
            return createGenerator(
                function (context) {
                    return prepareGenerator(generator, context).chain(function dependentDomain(value) {
                        context.consumeWork();
                        return prepareGenerator(transform(value), context);
                    });
                },
                null,
                function* dependentEdges(context) {
                    for (const source of edges(context)) {
                        context.consumeWork();
                        const dependent = transform(source());
                        const candidates = indexedEdges(readGeneratorEdges(dependent)(context));
                        for (const [ retainedOrdinal ] of candidates) {
                            yield function reconstructDependentEdge() {
                                context.consumeWork();
                                const fresh = transform(source());
                                const input = edgeAt(readGeneratorEdges(fresh), context, retainedOrdinal);
                                if (input === null) {
                                    throw new Error('Dependent edge could not be reconstructed.');
                                }
                                return input();
                            };
                        }
                    }
                }
            );
        },
        filter(predicate: (value: Value) => boolean): Generator<Value> {
            ensureCallback(predicate);
            return createGenerator(
                function (context) {
                    return prepareGenerator(generator, context).filter(function acceptsValue(value) {
                        context.consumeWork();
                        const accepted = predicate(value);
                        if (typeof accepted !== 'boolean') {
                            throw new TypeError('Generator filter predicates must return a boolean.');
                        }
                        if (!accepted) {
                            context.rejectInput();
                        }
                        return accepted;
                    });
                },
                codec,
                function* filteredEdges(context) {
                    for (const input of edges(context)) {
                        context.consumeWork();
                        const accepted = predicate(input());
                        if (typeof accepted !== 'boolean') {
                            throw new TypeError('Generator filter predicates must return a boolean.');
                        }
                        if (accepted) {
                            yield input;
                        } else {
                            context.rejectInput();
                        }
                    }
                }
            );
        },
        withCodec(inputCodec: PropertyInputCodec<Value>): Generator<Value> {
            return createGenerator(resolve, inputCodec, edges);
        }
    };
    return Object.freeze(generator);
}
