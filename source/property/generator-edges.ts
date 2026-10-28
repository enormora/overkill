import type { GeneratorContext } from './generator-backend.ts';

export type InputRecipe<Value> = () => Value;
export type GeneratorEdgeSource<Value> = (context: GeneratorContext) => Iterable<InputRecipe<Value>>;

type ProductEdges<Component, Value> = {
    readonly sources: readonly GeneratorEdgeSource<Component>[];
    readonly build: (values: readonly Component[]) => Value;
    readonly context: GeneratorContext;
};

export function* indexedEdges<Value>(
    inputs: Iterable<InputRecipe<Value>>
): Generator<readonly [number, InputRecipe<Value>]> {
    let ordinal = 0;
    for (const input of inputs) {
        yield [ ordinal, input ];
        ordinal += 1;
    }
}

export function scalarEdges<Value>(values: readonly Value[]): GeneratorEdgeSource<Value> {
    const representatives = values.filter(function firstOccurrence(value, index) {
        return values.findIndex(function sameValue(candidate) {
            return Object.is(value, candidate);
        }) === index;
    });
    return function* edges(context) {
        for (const value of representatives) {
            context.consumeWork();
            yield function reconstructScalar() {
                return value;
            };
        }
    };
}

export function edgeAt<Value>(
    source: GeneratorEdgeSource<Value>,
    context: GeneratorContext,
    index: number
): InputRecipe<Value> | null {
    context.consumeWork();
    return Iterator.from(source(context)).drop(index).next().value ?? null;
}

function productRecipe<Component, Value>(
    product: ProductEdges<Component, Value>,
    component: number,
    ordinal: number
): InputRecipe<Value> {
    return function reconstructProduct() {
        return product.build(product.sources.map(function reconstructComponent(source, index) {
            const input = edgeAt(source, product.context, index === component ? ordinal : 0);
            if (input === null) {
                throw new Error('Automatic edge could not be reconstructed.');
            }
            product.context.consumeWork();
            return input();
        }));
    };
}

export function productEdges<Component, Value>(
    sources: readonly GeneratorEdgeSource<Component>[],
    build: (values: readonly Component[]) => Value
): GeneratorEdgeSource<Value> {
    return function* edges(context) {
        if (
            sources.some(function missingBaseline(source) {
                return edgeAt(source, context, 0) === null;
            })
        ) {
            return;
        }
        const product = { sources, build, context };
        yield productRecipe(product, -1, 0);
        for (const [ component, source ] of sources.entries()) {
            const alternatives = indexedEdges(source(context));
            const variations = alternatives.drop(1);
            for (const [ ordinal ] of variations) {
                context.consumeWork();
                yield productRecipe(product, component, ordinal);
            }
        }
    };
}

type EdgeRound<Value> = {
    readonly active: readonly IteratorObject<InputRecipe<Value>>[];
    readonly inputs: readonly InputRecipe<Value>[];
};

function nextEdgeRound<Value>(
    iterators: readonly IteratorObject<InputRecipe<Value>>[],
    context: GeneratorContext
): EdgeRound<Value> {
    const active: IteratorObject<InputRecipe<Value>>[] = [];
    const inputs: InputRecipe<Value>[] = [];
    for (const iterator of iterators) {
        context.consumeWork();
        const next = iterator.next();
        if (next.done !== true) {
            inputs.push(next.value);
            active.push(iterator);
        }
    }
    return { active, inputs };
}

export function interleavedEdges<Value>(sources: readonly GeneratorEdgeSource<Value>[]): GeneratorEdgeSource<Value> {
    return function* edges(context) {
        let active: readonly IteratorObject<InputRecipe<Value>>[] = sources.map(function sourceIterator(source) {
            return Iterator.from(source(context));
        });
        while (active.length > 0) {
            const round = nextEdgeRound(active, context);
            yield* round.inputs;
            active = round.active;
        }
    };
}
