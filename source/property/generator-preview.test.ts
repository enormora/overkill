import type { TestScope } from '../packages/engine/engine.entry-point.ts';
import { suite, test } from '../packages/test/test.entry-point.ts';
import { sampleGenerator } from './generator-preview.ts';
import { gen } from './generators.ts';

type PreviewTree = { readonly left: PreviewTree; readonly right: PreviewTree; } | null;

const request = { seed: 42n, count: 10, size: 3, depth: 0 };

export const testNode = suite('generator previews', [
    test('samples have independent mutable storage', function (scope: TestScope) {
        const values = sampleGenerator(gen.array(gen.boolean()), request);
        const first = values[0];
        const second = values[1];
        scope.require.defined(first);
        scope.require.defined(second);
        first.push(true);
        scope.assert.equal(first === second, false);
        scope.assert.equal(second.length <= 3, true);
        return scope.assert.collect();
    }),
    test('validates request shape and generator identity before empty previews', function (scope: TestScope) {
        for (
            const invalid of [
                null,
                {},
                { ...request, seed: 42 },
                { ...request, depth: Number.POSITIVE_INFINITY },
                { ...request, size: 0.5 },
                { ...request, count: Number.NaN },
                { ...request, extra: true }
            ]
        ) {
            scope.assert.throws(function malformedRequest() {
                Reflect.apply(sampleGenerator, undefined, [ gen.boolean(), invalid ]);
            }, { name: 'RangeError' });
        }
        scope.assert.throws(function foreignGenerator() {
            Reflect.apply(sampleGenerator, undefined, [ {}, { ...request, count: 0 } ]);
        }, { name: 'TypeError' });
        return scope.assert.collect();
    }),
    test('recursive preview depth zero forces leaves', function (scope: TestScope) {
        const tree = gen.recursive<PreviewTree>({
            leaf: gen.constant(null),
            branch(child) {
                return gen.record({ left: child, right: child });
            },
            maxDepth: 5
        });
        scope.assert.deepEqual(
            sampleGenerator(tree, request),
            Array.from({ length: 10 }, function () {
                return null;
            })
        );
        return scope.assert.collect();
    }),
    test('reproduces isolated streams without truncating seeds', function (scope: TestScope) {
        const generator = gen.integer({ min: 0, max: 1_000_000 });
        const first = sampleGenerator(generator, request);
        sampleGenerator(generator, { ...request, seed: -42n });
        scope.assert.deepEqual(first, sampleGenerator(generator, request));
        scope.assert.equal(first.length, 10);
        scope.assert.equal(Object.isFrozen(first), true);
        scope.assert.equal(
            JSON.stringify(first) === JSON.stringify(sampleGenerator(generator, {
                ...request,
                seed: 42n + 2n ** 64n
            })),
            false
        );
        return scope.assert.collect();
    }),
    test('bounds rejection and rejects incomplete previews', function (scope: TestScope) {
        scope.assert.throws(function impossibleFilter() {
            sampleGenerator(
                gen.boolean().filter(function () {
                    return false;
                }),
                request
            );
        }, { name: 'RangeError' });
        scope.assert.throws(function exhaustedWork() {
            sampleGenerator(gen.constant(1), { ...request, count: Number.MAX_SAFE_INTEGER });
        }, { name: 'RangeError' });
        scope.assert.throws(function emptyDomain() {
            sampleGenerator(gen.string({ minLength: 4, maxLength: 5 }), request);
        }, { name: 'RangeError' });
        scope.assert.throws(function invalidRequest() {
            sampleGenerator(gen.boolean(), { ...request, count: -1 });
        }, { name: 'RangeError' });
        return scope.assert.collect();
    }),
    test('zero count defers callbacks and repeated values remain samples', function (scope: TestScope) {
        const generator = gen.constant(1).map(function unexpectedGeneration() {
            throw new Error('Must remain deferred');
        });
        scope.assert.deepEqual(sampleGenerator(generator, { ...request, count: 0 }), []);
        scope.assert.deepEqual(
            sampleGenerator(gen.constant(1), request),
            Array.from({ length: 10 }, function () {
                return 1;
            })
        );
        return scope.assert.collect();
    }),
    test('reconstructs mutable dependent inputs without calling codecs', function (scope: TestScope) {
        const generator = gen
            .array(gen.boolean())
            .flatMap(function dependent(values) {
                return gen.record({
                    values: gen.constant(null).map(function () {
                        return values;
                    }),
                    length: gen.constant(values.length)
                });
            })
            .withCodec({
                name: 'unused',
                version: 1,
                previousDecoders: [],
                encode() {
                    throw new Error('Preview must not encode');
                },
                decode() {
                    throw new Error('Preview must not decode');
                }
            });
        const values = sampleGenerator(generator, request);
        for (const value of values) {
            scope.assert.equal(value.values.length, value.length);
            scope.assert.equal(value.length <= 3, true);
        }
        return scope.assert.collect();
    })
]);
