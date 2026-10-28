import { runIfMain } from '#test-runner';
import type { TestScope } from '../packages/engine/engine.entry-point.ts';
import { suite, test } from '../packages/test/test.entry-point.ts';
import { generatorContext } from '../test-support/generator-execution.ts';
import { readGeneratorEdges, type Generator as PropertyGenerator } from './generator.ts';
import { gen } from './generators.ts';

function edgeValues<Value>(generator: PropertyGenerator<Value>): Value[] {
    const inputs = readGeneratorEdges(generator)(generatorContext(8, 3, 100_000));
    return Array.from(Iterator.from(inputs).take(20), function reconstruct(input) {
        return input();
    });
}

export const testNode = suite('automatic generator edges', [
    test('keeps bounded numeric and empty string representatives in their domains', function (scope) {
        scope.assert.deepEqual(edgeValues(gen.number({ min: -0.5, max: 0.5 })), [ -0.5, 0.5, 0, -0 ]);
        const strings = edgeValues(gen.string());
        scope.assert.equal(strings[0], '');
        scope.assert.true(strings.every(function withinActiveSize(value) {
            return value.length <= 8;
        }));
        return scope.assert.collect();
    }),
    test('omits structural edges whose components have no representatives', function (scope) {
        const unavailable = gen.constant(1).filter(function () {
            return false;
        });
        scope.assert.deepEqual(edgeValues(gen.tuple(unavailable)), []);
        scope.assert.deepEqual(edgeValues(gen.record({ value: unavailable })), []);
        scope.assert.deepEqual(edgeValues(gen.array(unavailable)), [ [] ]);
        return scope.assert.collect();
    }),
    test('rejects unbranded automatic-edge sources', function (scope) {
        scope.assert.throws(function () {
            Reflect.apply(readGeneratorEdges, undefined, [ {} ]);
        }, { message: 'Property requires an Overkill generator.' });
        return scope.assert.collect();
    }),
    test('rejects a dependent domain that changes during edge reconstruction', function (scope: TestScope) {
        let resolutions = 0;
        const generator = gen.constant(1).flatMap(function changingDomain() {
            resolutions += 1;
            return resolutions === 1 ? gen.constant(1) : gen.constant(1).filter(function () {
                return false;
            });
        });
        const [ recipe ] = Iterator.from(readGeneratorEdges(generator)(generatorContext(8, 3, 1000))).take(1).toArray();
        scope.require.defined(recipe);
        scope.assert.throws(recipe, { message: 'Dependent edge could not be reconstructed.' });
        return scope.assert.collect();
    }),
    test('rejects a structural component that disappears during edge reconstruction', function (scope: TestScope) {
        let evaluations = 0;
        const generator = gen.tuple(
            gen.constant(1).filter(function changingDomain() {
                evaluations += 1;
                return evaluations === 1;
            })
        );
        const [ recipe ] = Iterator.from(readGeneratorEdges(generator)(generatorContext(8, 3, 1000))).take(1).toArray();
        scope.require.defined(recipe);
        scope.assert.throws(recipe, { message: 'Automatic edge could not be reconstructed.' });
        return scope.assert.collect();
    }),
    test('includes primitive extrema and special values deterministically', function (scope) {
        scope.assert.deepEqual(edgeValues(gen.boolean()), [ false, true ]);
        scope.assert.deepEqual(edgeValues(gen.integer({ min: -2, max: 4 })), [ -2, 4, 0, -1, 1 ]);
        scope.assert.deepEqual(edgeValues(gen.bigint({ min: -2n, max: 4n })), [ -2n, 4n, 0n, -1n, 1n ]);
        const numbers = edgeValues(gen.number());
        scope.assert.true(numbers.some(Number.isNaN));
        scope.assert.true(numbers.includes(Number.POSITIVE_INFINITY));
        scope.assert.true(numbers.some(function negativeZero(value) {
            return Object.is(value, -0);
        }));
        scope.assert.deepEqual(edgeValues(gen.constant('only')), [ 'only' ]);
        return scope.assert.collect();
    }),
    test('reconstructs container edges within active length bounds', function (scope) {
        const strings = edgeValues(gen.string({ minLength: 1, maxLength: 2 }));
        scope.assert.true(strings.includes('\u{D800}'));
        scope.assert.true(strings.includes('\u{DC00}'));
        scope.assert.deepEqual(
            Array.from(
                new Set(strings.map(function length(value) {
                    return value.length;
                }))
            ),
            [ 1, 2 ]
        );
        scope.assert.deepEqual(
            edgeValues(gen.bytes({ minLength: 0, maxLength: 1 })).map(function bytes(value) {
                return Array.from(value);
            }),
            [ [], [ 0 ], [ 255 ] ]
        );
        scope.assert.deepEqual(edgeValues(gen.tuple()), [ [] ]);
        scope.assert.deepEqual(edgeValues(gen.record({})), [ {} ]);
        scope.assert.deepEqual(edgeValues(gen.choice(gen.constant(1), gen.constant(2))), [ 1, 2 ]);
        return scope.assert.collect();
    }),
    test('preserves dependent edge domains and fresh reconstructed inputs', function (scope) {
        const generator = gen.array(gen.integer({ min: 0, max: 9 }), { minLength: 1, maxLength: 3 }).flatMap(
            function indexed(values) {
                return gen.tuple(
                    gen.constant(null).map(function () {
                        return values;
                    }),
                    gen.integer({ min: 0, max: values.length - 1 })
                );
            }
        );
        const recipes = Iterator
            .from(readGeneratorEdges(generator)(generatorContext(8, 3, 100_000)))
            .take(20)
            .toArray();
        for (const recipe of recipes) {
            const [ values, index ] = recipe();
            const snapshot = Array.from(values);
            scope.assert.true(index >= 0 && index < values.length);
            values.push(100);
            scope.assert.deepEqual(recipe()[0], snapshot);
        }
        scope.assert.true(recipes.length > 3);
        return scope.assert.collect();
    }),
    test('filters automatic edges without rejecting valid exploration domains', function (scope) {
        scope.assert.deepEqual(
            edgeValues(
                gen.integer({ min: 0, max: 10 }).filter(function (value) {
                    return value === 5;
                })
            ),
            []
        );
        scope.assert.deepEqual(
            edgeValues(
                gen.integer({ min: 0, max: 10 }).filter(function (value) {
                    return value > 0;
                })
            ),
            [ 10, 1 ]
        );
        scope.assert.deepEqual(
            edgeValues(
                gen.boolean().map(function () {
                    return 'same';
                })
            ),
            [ 'same', 'same' ]
        );
        return scope.assert.collect();
    }),
    test('varies structural components without a Cartesian edge product', function (scope) {
        const integer = gen.integer({ min: 0, max: 10 });
        const values = edgeValues(gen.tuple(integer, integer, integer, integer));
        scope.assert.equal(values.length, 9);
        scope.assert.deepEqual(values.slice(0, 1), [ [ 0, 0, 0, 0 ] ]);
        scope.assert.true(values.every(function representative(value) {
            return value
                .filter(function differsFromBaseline(component) {
                    return component !== 0;
                })
                .length <= 1;
        }));
        return scope.assert.collect();
    }),
    test('keeps recursive representatives within active depth', function (scope) {
        const generator = gen.recursive<number[]>({
            leaf: gen.constant(null).map<number[]>(function () {
                return [];
            }),
            branch(child) {
                return child.map(function (values) {
                    return [ values.length, ...values ];
                });
            },
            maxDepth: 2
        });
        scope.assert.deepEqual(edgeValues(generator), [ [], [ 0 ], [ 1, 0 ] ]);
        return scope.assert.collect();
    })
]);

await runIfMain(import.meta, testNode);
