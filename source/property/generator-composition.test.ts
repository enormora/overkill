import type { TestScope } from '../packages/engine/engine.entry-point.ts';
import { suite, test } from '../packages/test/test.entry-point.ts';
import {
    generatedCandidate,
    generatedValues,
    generatorContext,
    shrinkCandidates
} from '../test-support/generator-execution.ts';
import { gen } from './generators.ts';
import { prepareGenerator } from './generator.ts';

type CompositeInput = {
    readonly pair: readonly ['name', number];
    readonly flag: boolean | null;
    readonly values: readonly number[];
};

function assertCompositeDomain(scope: TestScope, input: CompositeInput): void {
    scope.assert.deepEqual(
        Object.keys(input).toSorted(function compareKeys(left, right) {
            return left.localeCompare(right);
        }),
        [ 'flag', 'pair', 'values' ]
    );
    scope.assert.equal(input.pair[0], 'name');
    scope.assert.equal(input.pair[1] >= 1 && input.pair[1] <= 9, true);
    scope.assert.equal([ true, null ].includes(input.flag), true);
    scope.assert.equal(input.values.length > 0 && input.values.length <= 2, true);
    scope.assert.equal(
        input.values.every(function inDomain(value) {
            return value >= 4 && value <= 7;
        }),
        true
    );
}

type IndexedInput = {
    readonly values: readonly number[];
    readonly index: number;
    readonly dependent: readonly number[];
};

function assertIndexedDomain(scope: TestScope, input: IndexedInput): void {
    scope.assert.equal(input.index >= 0 && input.index < input.values.length, true);
    scope.assert.equal(
        input.dependent.every(function respectsSource(value) {
            return value >= 0 && value <= input.values.length;
        }),
        true
    );
}

export const testNode = suite('generator composition', [
    test('preserves tuple positions, required record fields, and choices', function (scope) {
        const generator = gen.record({
            pair: gen.tuple(gen.constant('name'), gen.integer({ min: 1, max: 9 })),
            flag: gen.choice(gen.constant(true), gen.constant(null)),
            values: gen.array(gen.integer({ min: 4, max: 7 }), { minLength: 1, maxLength: 3 })
        });
        const domain = prepareGenerator(generator, generatorContext(2, 3, 100_000));
        for (let seed = 0; seed < 20; seed += 1) {
            const root = generatedCandidate(domain, seed);
            for (const candidate of [ root, ...shrinkCandidates(domain, root, 40) ]) {
                assertCompositeDomain(scope, candidate.value);
            }
        }
        return scope.assert.collect();
    }),
    test('supports empty tuples and records', function (scope) {
        scope.assert.deepEqual(generatedValues(gen.tuple(), 1, generatorContext(0, 0, 100)), [ [] ]);
        scope.assert.deepEqual(generatedValues(gen.record({}), 1, generatorContext(0, 0, 100)), [ {} ]);
        return scope.assert.collect();
    }),
    test('maps source shrinks without requiring an inverse or smaller displayed outputs', function (scope) {
        const mapped = gen.integer({ min: 1, max: 100 }).map(function mappedValue(value) {
            return { source: value, display: 1 / value };
        });
        const domain = prepareGenerator(mapped, generatorContext(10, 3, 100_000));
        const root = generatedCandidate(domain, 42);
        const shrinks = shrinkCandidates(domain, root, 50);
        scope.assert.equal(shrinks.length > 0, true);
        scope.assert.equal(
            shrinks.every(function preservesMapping(candidate) {
                return candidate.value.display === 1 / candidate.value.source && candidate.value.source >= 1;
            }),
            true
        );
        scope.assert.equal(
            shrinks.some(function largerDisplay(candidate) {
                return candidate.value.display > root.value.display;
            }),
            true
        );
        return scope.assert.collect();
    }),
    test('supports repeated and expanding transformations', function (scope) {
        const constant = gen.integer({ min: 0, max: 100 }).map(function repeatedOutput() {
            return 'same';
        });
        const constantDomain = prepareGenerator(constant, generatorContext(10, 3, 1000));
        const repeated = shrinkCandidates(constantDomain, generatedCandidate(constantDomain, 42), 20);
        scope.assert.equal(
            repeated.every(function unchanged(candidate) {
                return candidate.value === 'same';
            }),
            true
        );
        scope.assert.equal(
            generatedValues(
                gen.constant(0).map(function expanded() {
                    return 'long';
                }),
                1,
                generatorContext(0, 0, 100)
            )[0],
            'long'
        );
        return scope.assert.collect();
    }),
    test('retains array-index and changing dependent element bounds through shrinking', function (scope) {
        const generator = gen.array(gen.integer({ min: 0, max: 100 }), { minLength: 1, maxLength: 8 }).flatMap(
            function indexedArray(values) {
                return gen.record({
                    values: gen.tuple(gen.constant(null)).map(function retainArray() {
                        return values;
                    }),
                    index: gen.integer({ min: 0, max: values.length - 1 }),
                    dependent: gen.array(gen.integer({ min: 0, max: values.length }), { minLength: 1, maxLength: 3 })
                });
            }
        );
        const domain = prepareGenerator(generator, generatorContext(8, 4, 500_000));
        let examined = 0;
        for (let seed = 0; seed < 20; seed += 1) {
            const root = generatedCandidate(domain, seed);
            for (const candidate of [ root, ...shrinkCandidates(domain, root, 100) ]) {
                assertIndexedDomain(scope, candidate.value);
                examined += 1;
            }
        }
        scope.assert.equal(examined > 100, true);
        return scope.assert.collect();
    }),
    test('snapshots numeric and length bounds', function (scope) {
        const bounds = { min: 1, max: 1 };
        const lengths = { minLength: 1, maxLength: 1 };
        const integer = gen.integer(bounds);
        const string = gen.string(lengths);
        Object.assign(bounds, { min: 50, max: 50 });
        Object.assign(lengths, { minLength: 10, maxLength: 10 });
        scope.assert.deepEqual(generatedValues(integer, 1, generatorContext(3, 1, 100)), [ 1 ]);
        scope.assert.equal(generatedValues(string, 1, generatorContext(3, 1, 100))[0]?.length, 1);
        return scope.assert.collect();
    }),
    test('snapshots record fields and tuple components', function (scope) {
        const fields = { value: gen.integer({ min: 1, max: 1 }) };
        const elements = [ gen.constant('original') ];
        const record = gen.record(fields);
        const tuple = gen.tuple(...elements);
        fields.value = gen.integer({ min: 99, max: 99 });
        elements.length = 0;
        scope.assert.deepEqual(generatedValues(record, 1, generatorContext(3, 1, 100)), [ { value: 1 } ]);
        scope.assert.deepEqual(generatedValues(tuple, 1, generatorContext(3, 1, 100)), [ [ 'original' ] ]);
        return scope.assert.collect();
    }),
    test('rejects foreign generators and unsupported record declarations', function (scope) {
        for (
            const value of [ {}, null, function () {
                return 1;
            }, { [Symbol.for('@overkill-dev/property/Generator')]: true } ]
        ) {
            for (const construct of [ gen.array, gen.tuple, gen.choice ]) {
                scope.assert.throws(function foreignGenerator() {
                    Reflect.apply(construct, undefined, [ value ]);
                }, { name: 'TypeError' });
            }
            scope.assert.throws(function foreignField() {
                Reflect.apply(gen.record, undefined, [ { field: value } ]);
            }, { name: 'TypeError' });
        }
        return scope.assert.collect();
    }),
    test('rejects empty choices and unsupported record declarations', function (scope) {
        scope.assert.throws(function emptyChoice() {
            Reflect.apply(gen.choice, undefined, []);
        }, { name: 'RangeError' });
        scope.assert.throws(function getterField() {
            gen.record({
                get field(): never {
                    throw new Error('Getter must not execute.');
                }
            });
        }, { name: 'TypeError' });
        scope.assert.throws(function symbolField() {
            Reflect.apply(gen.record, undefined, [ { [Symbol('field')]: gen.boolean() } ]);
        }, { name: 'TypeError' });
        for (const value of [ null, [], false, new Date() ]) {
            scope.assert.throws(function invalidRecord() {
                Reflect.apply(gen.record, undefined, [ value ]);
            }, { name: 'TypeError' });
        }
        const inherited: unknown = Object.create({ field: gen.boolean() });
        scope.assert.throws(function inheritedField() {
            Reflect.apply(gen.record, undefined, [ inherited ]);
        }, { name: 'TypeError' });
        return scope.assert.collect();
    }),
    test('preserves fields named __proto__ as own data', function (scope) {
        const named = gen.record({ ['__proto__']: gen.constant('own field') });
        const [ value ] = generatedValues(named, 1, generatorContext(0, 0, 100));
        scope.assert.equal(Object.hasOwn(value ?? {}, '__proto__'), true);
        const fields = { value: gen.constant('null prototype') };
        Object.setPrototypeOf(fields, null);
        scope.assert.deepEqual(generatedValues(gen.record(fields), 1, generatorContext(0, 0, 100)), [
            { value: 'null prototype' }
        ]);
        return scope.assert.collect();
    })
]);
