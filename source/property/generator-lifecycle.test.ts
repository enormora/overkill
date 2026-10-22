import { suite, test } from '../packages/test/test.entry-point.ts';
import {
    generatedCandidate,
    generatedValues,
    generatorContext,
    shrinkCandidates
} from '../test-support/generator-execution.ts';
import { gen } from './generators.ts';
import { prepareGenerator, readGeneratorCodec, isGenerator, type Generator as PropertyGenerator } from './generator.ts';
import type { PropertyInputCodec } from './property-codec.ts';

function unexpectedCallback(): never {
    throw new Error('Callback must remain deferred.');
}

const codec: PropertyInputCodec<number> = {
    name: 'number',
    version: 1,
    previousDecoders: [],
    encode: unexpectedCallback,
    decode: unexpectedCallback
};

function malformedComposition(method: 'filter' | 'flatMap', callback: () => unknown): PropertyGenerator<unknown> {
    const source = gen.constant(1);
    const compose: unknown = source[method];
    if (typeof compose !== 'function') {
        throw new TypeError('Missing composition method.');
    }
    const result: unknown = Reflect.apply(compose, source, [ callback ]);
    if (!isGenerator(result)) {
        throw new Error('Composition must return a generator.');
    }
    return result;
}

export const testNode = suite('generator lifecycle', [
    test('defers transformations, predicates, and recursive branches', function (scope) {
        for (
            const value of [
                gen.constant(0).map(unexpectedCallback),
                gen.constant(0).flatMap(unexpectedCallback),
                gen.constant(0).filter(unexpectedCallback),
                gen.recursive({ leaf: gen.integer({ min: 0, max: 1 }), branch: unexpectedCallback, maxDepth: 5 })
            ]
        ) {
            scope.assert.equal(Object.isFrozen(value), true);
            prepareGenerator(
                value.map<unknown>(function deferredValue(input) {
                    return input;
                }),
                generatorContext(10, 3, 100)
            );
        }
        return scope.assert.collect();
    }),
    test('attaches codecs without executing them and preserves them through filtering', function (scope) {
        const attached = gen.integer({ min: 0, max: 1 }).withCodec(codec);
        scope.assert.equal(generatedValues(attached, 2, generatorContext(10, 3, 100)).length, 2);
        scope.assert.equal(readGeneratorCodec(attached), codec);
        scope.assert.equal(
            readGeneratorCodec(attached.filter(function accepted() {
                return true;
            })),
            codec
        );
        scope.assert.equal(readGeneratorCodec(attached.map(String)), null);
        scope.assert.equal(
            readGeneratorCodec(attached.flatMap(function dependent() {
                return gen.constant(1);
            })),
            null
        );
        return scope.assert.collect();
    }),
    test('requires codecs to be attached to the complete structural input', function (scope) {
        const attached = gen.integer({ min: 0, max: 1 }).withCodec(codec);
        scope.assert.equal(readGeneratorCodec(gen.array(attached)), null);
        scope.assert.equal(readGeneratorCodec(gen.record({ attached })), null);
        scope.assert.equal(readGeneratorCodec(gen.tuple(attached)), null);
        scope.assert.equal(readGeneratorCodec(gen.choice(attached)), null);
        scope.assert.equal(
            readGeneratorCodec(gen.recursive({
                leaf: attached,
                branch(child) {
                    return child;
                },
                maxDepth: 2
            })),
            null
        );
        return scope.assert.collect();
    }),
    test('bounds impossible filtering', function (scope) {
        let predicates = 0;
        const impossible = gen.constant(1).filter(function rejected() {
            predicates += 1;
            return false;
        });
        scope.assert.throws(function exhaustFilter() {
            generatedValues(impossible, 1, generatorContext(10, 3, 25));
        }, { message: 'Generator work exhausted.' });
        scope.assert.equal(predicates > 0 && predicates < 25, true);
        return scope.assert.collect();
    }),
    test('preserves generator callback exceptions', function (scope) {
        for (
            const generator of [
                gen.constant(1).map(unexpectedCallback),
                gen.constant(1).flatMap(unexpectedCallback),
                gen.constant(1).filter(unexpectedCallback),
                gen.recursive({ leaf: gen.integer({ min: 1, max: 1 }), branch: unexpectedCallback, maxDepth: 1 })
            ]
        ) {
            scope.assert.throws(function retainCallbackError() {
                generatedValues(
                    generator.map<unknown>(function generatedInput(input) {
                        return input;
                    }),
                    1,
                    generatorContext(10, 3, 100)
                );
            }, { message: 'Callback must remain deferred.' });
        }
        return scope.assert.collect();
    }),
    test('rejects invalid callback results and callback arguments', function (scope) {
        scope.assert.throws(function invalidDependentGenerator() {
            generatedValues(
                malformedComposition('flatMap', function foreignDomain() {
                    return {};
                }),
                1,
                generatorContext(10, 3, 100)
            );
        }, { message: 'Property requires an Overkill generator.' });
        scope.assert.throws(function nonBooleanPredicate() {
            generatedValues(
                malformedComposition('filter', function invalidPredicate() {
                    return 'truthy';
                }),
                1,
                generatorContext(10, 3, 100)
            );
        }, { message: 'Generator filter predicates must return a boolean.' });
        const generator = gen.constant(1);
        for (const compose of [ generator.map, generator.flatMap, generator.filter ]) {
            scope.assert.throws(function invalidCallback() {
                Reflect.apply(compose, generator, [ null ]);
            }, { message: 'Generator composition requires a callback.' });
        }
        return scope.assert.collect();
    }),
    test('filters shrink candidates without leaving the declared domain', function (scope) {
        const generator = gen.integer({ min: 0, max: 100 }).filter(function even(value) {
            return value % 2 === 0;
        });
        const domain = prepareGenerator(generator, generatorContext(10, 3, 100_000));
        const candidates = shrinkCandidates(domain, generatedCandidate(domain, 42), 50);
        scope.assert.equal(
            candidates.every(function even(candidate) {
                return candidate.value % 2 === 0;
            }),
            true
        );
        scope.assert.equal(candidates.length > 0, true);
        return scope.assert.collect();
    }),
    test('bounds rejection hidden inside shrink traversal', function (scope) {
        const generator = gen.integer({ min: 0, max: 100 }).filter(function onlyHundred(value) {
            return value === 100;
        });
        const domain = prepareGenerator(generator, generatorContext(10, 3, 100_000));
        const root = generatedCandidate(domain, 42);
        const bounded = prepareGenerator(generator, generatorContext(10, 3, 5));
        scope.assert.throws(function exhaustRejectedShrinks() {
            Array.from(bounded.shrink(root.value, root.context));
        }, { message: 'Generator work exhausted.' });
        return scope.assert.collect();
    }),
    test('reports domains excluded by active size caps', function (scope) {
        for (
            const generator of [
                gen.array(gen.integer({ min: 1, max: 2 }), { minLength: 2, maxLength: 5 }),
                gen.string({ minLength: 2, maxLength: 5 }),
                gen.bytes({ minLength: 2, maxLength: 5 })
            ]
        ) {
            scope.assert.throws(function emptyDomain() {
                generatedValues(
                    generator.map<unknown>(function generatedInput(input) {
                        return input;
                    }),
                    1,
                    generatorContext(1, 3, 100)
                );
            }, { message: 'Generator domain exhausted.' });
        }
        return scope.assert.collect();
    }),
    test('keeps compilation sessions deterministic and independent', function (scope) {
        const generator = gen.array(gen.integer({ min: 1, max: 2 }), { minLength: 2, maxLength: 5 });
        const first = generatedValues(generator, 20, generatorContext(3, 2, 100_000));
        scope.assert.deepEqual(generatedValues(generator, 20, generatorContext(3, 2, 100_000)), first);
        scope.assert.equal(
            first.every(function withinSize(value) {
                return value.length >= 2 && value.length <= 3;
            }),
            true
        );
        scope.assert.throws(function distinctBudget() {
            generatedValues(
                generator.map<unknown>(function generatedInput(input) {
                    return input;
                }),
                1,
                generatorContext(3, 2, 1)
            );
        }, { message: 'Generator work exhausted.' });
        scope.assert.deepEqual(generatedValues(generator, 20, generatorContext(3, 2, 100_000)), first);
        return scope.assert.collect();
    })
]);
