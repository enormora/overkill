import { runIfMain } from '#test-runner';
import { suite, test } from '../packages/test/test.entry-point.ts';
import { executePropertyNode, propertyExecutionDefaults } from '../test-support/property-execution.ts';
import { property, withProperties } from './property-authoring.ts';
import { createCoverage, coverageRequirements } from './property-coverage.ts';
import { enumerateDomain } from './generator-enumeration.ts';
import { createPropertyWork } from './property-work.ts';
import { propertyLabels } from './property-targets.ts';
import { gen } from './generators.ts';

export const testNode = suite('exhaustive input coverage', [
    test('accepts exact percentage boundaries without rounding the observed ratio', function (scope) {
        const coverage = createCoverage([ { label: 'hit', minimumPercent: 29 } ], propertyLabels(1));
        for (let index = 0; index < 100; index += 1) {
            const trial = coverage.trial('exploration');
            trial.cover('hit', index < 29);
            trial.finish(true);
        }
        scope.assert.deepEqual(coverage.unmet(), []);
        return scope.assert.collect();
    }),
    test('checks coverage independently for nested invocations', async function (scope) {
        const node = test(
            'nested coverage',
            withProperties(async function (parent) {
                await parent.forall({
                    generator: gen.constant<boolean>(true),
                    coverage: [ { label: 'true', minimumPercent: 100 } ],
                    test(value, sample) {
                        sample.cover('true', value);
                        sample.assert.true(value);
                        return sample.assert.collect();
                    }
                });
                return parent.forall({
                    generator: gen.constant<boolean>(false),
                    coverage: [ { label: 'true', minimumPercent: 1 } ],
                    test(value, sample) {
                        sample.cover('true', value);
                        sample.assert.false(value);
                        return sample.assert.collect();
                    }
                });
            })
        );
        const result = await executePropertyNode(node, propertyExecutionDefaults);
        scope.assert.equal(result.summary.inconclusive, 1);
        return scope.assert.collect();
    }),
    test('enumerates bounded recursive composition', function (scope) {
        const work = createPropertyWork(propertyExecutionDefaults.policy);
        const generator = gen.recursive<number>({
            leaf: gen.constant<number>(0),
            branch(child) {
                return child.map(function (value) {
                    return value + 1;
                });
            },
            maxDepth: 2
        });
        const inputs = enumerateDomain(generator, work.context, 20);
        scope.assert.deepEqual(
            (inputs ?? []).map(function (input) {
                return input();
            }),
            [ 0, 1, 2 ]
        );
        return scope.assert.collect();
    }),
    test('validates requirements and bounds trial observers', function (scope) {
        scope.assert.throws(function () {
            return coverageRequirements([ { label: 'same', minimumPercent: 1 }, { label: 'same', minimumPercent: 2 } ]);
        }, { name: 'ZodError' });
        scope.assert.throws(function () {
            return coverageRequirements([ { label: 'invalid', minimumPercent: Number.POSITIVE_INFINITY } ]);
        }, { name: 'ZodError' });
        const coverage = createCoverage([], propertyLabels(1));
        const trial = coverage.trial('exploration');
        trial.cover('first', true);
        scope.assert.throws(function () {
            trial.cover('second', true);
        }, { name: 'TestContractSignalError', message: /label limit/ });
        trial.finish(true);
        scope.assert.throws(function () {
            trial.cover('first', true);
        }, { name: 'TestContractSignalError', message: /outlived/ });
        return scope.assert.collect();
    }),
    test('enumerates exact numeric domains including both signed zeros', function (scope) {
        const work = createPropertyWork(propertyExecutionDefaults.policy);
        const inputs = enumerateDomain(gen.number({ min: -0, max: 0 }), work.context, 2);
        scope.assert.deepEqual(
            (inputs ?? []).map(function (input) {
                return input();
            }),
            [ -0, 0 ]
        );
        const integers = enumerateDomain(gen.integer({ min: -1, max: 1 }), work.context, 3);
        scope.assert.deepEqual(
            (integers ?? []).map(function (input) {
                return input();
            }),
            [ -1, 0, 1 ]
        );
        const bigints = enumerateDomain(gen.bigint({ min: 0n, max: 1n }), work.context, 2);
        scope.assert.deepEqual(
            (bigints ?? []).map(function (input) {
                return input();
            }),
            [ 0n, 1n ]
        );
        return scope.assert.collect();
    }),
    test('enumerates dependent domains under fresh source constraints', function (scope) {
        const work = createPropertyWork(propertyExecutionDefaults.policy);
        const generator = gen.integer({ min: 0, max: 1 }).flatMap(function (length) {
            return gen.array(gen.boolean(), { minLength: length, maxLength: length });
        });
        const inputs = enumerateDomain(generator, work.context, 20);
        scope.assert.deepEqual(
            (inputs ?? []).map(function (input) {
                return input();
            }),
            [ [], [ false ], [ true ] ]
        );
        return scope.assert.collect();
    }),
    test('recognizes empty structural singleton domains', function (scope) {
        const work = createPropertyWork(propertyExecutionDefaults.policy);
        scope.assert.deepEqual(
            (enumerateDomain(gen.record({}), work.context, 1) ?? []).map(function (input) {
                return input();
            }),
            [ {} ]
        );
        scope.assert.deepEqual(
            (enumerateDomain(gen.string({ minLength: 0, maxLength: 0 }), work.context, 1) ?? []).map(function (input) {
                return input();
            }),
            [ '' ]
        );
        scope.assert.deepEqual(
            (enumerateDomain(gen.bytes({ minLength: 0, maxLength: 0 }), work.context, 1) ?? []).map(function (input) {
                return input();
            }),
            [ new Uint8Array() ]
        );
        return scope.assert.collect();
    }),
    test('reports an empty filtered domain as inconclusive', async function (scope) {
        const result = await executePropertyNode(
            property({
                title: 'empty',
                generator: gen.boolean().filter(function () {
                    return false;
                }),
                settings: { maxExhaustiveValues: 2 },
                test(value, sample) {
                    sample.assert.equal(value, true);
                    return sample.assert.collect();
                }
            }),
            propertyExecutionDefaults
        );
        scope.assert.equal(result.summary.inconclusive, 1);
        return scope.assert.collect();
    }),
    test('does not let examples satisfy sampled coverage', async function (scope) {
        const result = await executePropertyNode(
            property({
                title: 'sample coverage',
                generator: gen.constant<boolean>(false),
                examples: [ function () {
                    return true;
                } ],
                coverage: [ { label: 'true', minimumPercent: 1 } ],
                test(value, sample) {
                    sample.cover('true', value);
                    sample.assert.equal(typeof value, 'boolean');
                    return sample.assert.collect();
                }
            }),
            propertyExecutionDefaults
        );
        scope.assert.equal(result.summary.inconclusive, 1);
        return scope.assert.collect();
    }),
    test('deduplicates exhaustive outputs and checks percentages over the complete domain', async function (scope) {
        const seen: number[] = [];
        const result = await executePropertyNode(
            property({
                title: 'distinct domain',
                generator: gen.choice(gen.constant(0), gen.constant(0), gen.constant(1)),
                settings: { maxExhaustiveValues: 10 },
                coverage: [ { label: 'positive', minimumPercent: 50 } ],
                test(value, sample) {
                    seen.push(value);
                    sample.cover('positive', value > 0);
                    sample.cover('positive', false);
                    sample.assert.true(value >= 0);
                    return sample.assert.collect();
                }
            }),
            propertyExecutionDefaults
        );
        scope.assert.equal(result.summary.passed, 1);
        scope.assert.deepEqual(seen, [ 0, 1 ]);
        return scope.assert.collect();
    }),
    test('keeps unmet exhaustive coverage inconclusive despite successful examples', async function (scope) {
        const result = await executePropertyNode(
            property({
                title: 'unmet',
                generator: gen.boolean(),
                examples: [ function () {
                    return true;
                } ],
                settings: { maxExhaustiveValues: 10 },
                coverage: [ { label: 'true', minimumPercent: 51 } ],
                test(value, sample) {
                    sample.cover('true', value);
                    sample.assert.equal(typeof value, 'boolean');
                    return sample.assert.collect();
                }
            }),
            propertyExecutionDefaults
        );
        scope.assert.equal(result.summary.inconclusive, 1);
        return scope.assert.collect();
    }),
    test('reconstructs mapped products without retaining body mutations', async function (scope) {
        const seen: number[][] = [];
        const result = await executePropertyNode(
            property({
                title: 'product',
                generator: gen.tuple(gen.boolean(), gen.boolean()).map(function (values) {
                    return { values };
                }),
                settings: { maxExhaustiveValues: 20 },
                test(value, sample) {
                    seen.push(value.values.map(Number));
                    sample.assert.equal(value.values.length, 2);
                    value.values.push(true);
                    return sample.assert.collect();
                }
            }),
            propertyExecutionDefaults
        );
        scope.assert.equal(result.summary.passed, 1);
        scope.assert.deepEqual(seen, [ [ 0, 0 ], [ 0, 1 ], [ 1, 0 ], [ 1, 1 ] ]);
        return scope.assert.collect();
    }),
    test('falls back to sampling when discovery exceeds its candidate limit', async function (scope) {
        let count = 0;
        const result = await executePropertyNode(
            property({
                title: 'fallback',
                generator: gen.integer({ min: 0, max: 100 }).map(function () {
                    return 1;
                }),
                settings: { maxExhaustiveValues: 2 },
                test(value, sample) {
                    count += 1;
                    sample.assert.equal(value, 1);
                    return sample.assert.collect();
                }
            }),
            propertyExecutionDefaults
        );
        scope.assert.equal(result.summary.passed, 1);
        scope.assert.equal(count, 3);
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);
