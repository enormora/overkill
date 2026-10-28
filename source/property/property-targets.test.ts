import { runIfMain } from '#test-runner';
import { Random } from 'fast-check';
import { xoroshiro128plus } from 'pure-rand/generator/xoroshiro128plus';
import { suite, test, type TestNode } from '../packages/test/test.entry-point.ts';
import { generatorContext } from '../test-support/generator-execution.ts';
import { executePropertyNode, propertyExecutionDefaults } from '../test-support/property-execution.ts';
import { property, gen } from '../packages/test/property.entry-point.ts';
import { trialTargets, propertyLabels } from './property-targets.ts';
import { propertySearch } from './property-search.ts';

function searchSequence(direction: number): number[] {
    const search = propertySearch(
        gen.integer({ min: -1000, max: 1000 }),
        new Random(xoroshiro128plus(42)),
        generatorContext(10, 3, 100_000),
        2
    );
    return Array.from({ length: 50 }, function explore() {
        const candidate = search.next();
        const value = candidate.input.reconstruct();
        search.accept(candidate, new Map([ [ 'value', direction * value ] ]));
        return value;
    });
}

export const testNode = suite('property targeting', [
    test('score stagnation completes and coverage remains independent', async function (scope) {
        const make = function (minimumPercent: number): TestNode {
            return property({
                title: 'targeted coverage',
                generator: gen.integer({ min: 0, max: 1000 }),
                coverage: [ { label: 'unreachable', minimumPercent } ],
                test(value, sample) {
                    sample.target('constant', 0);
                    sample.cover('unreachable', false);
                    sample.assert.true(value >= 0);
                    return sample.assert.collect();
                }
            });
        };
        const passed = await executePropertyNode(make(0), propertyExecutionDefaults);
        const unmet = await executePropertyNode(make(1), propertyExecutionDefaults);
        scope.assert.equal(passed.summary.passed, 1);
        scope.assert.equal(unmet.summary.inconclusive, 1);
        return scope.assert.collect();
    }),
    test('invalid observations preserve contract failures and stop inputs', async function (scope) {
        let calls = 0;
        const result = await executePropertyNode(
            property({
                title: 'invalid target',
                generator: gen.integer({ min: 0, max: 1000 }),
                test(_value, sample) {
                    calls += 1;
                    sample.target('score', Number.POSITIVE_INFINITY);
                    return sample.assert.collect();
                }
            }),
            propertyExecutionDefaults
        );
        scope.assert.equal(calls, 1);
        scope.assert.includes(JSON.stringify(result.perTest), 'property-observation');
        return scope.assert.collect();
    }),
    test('guided regeneration preserves dependent bounds', function (scope) {
        const generator = gen
            .array(gen.integer({ min: 0, max: 100 }), { minLength: 1, maxLength: 8 })
            .flatMap(function indexed(values) {
                return gen.integer({ min: 0, max: values.length - 1 }).map(function pair(index) {
                    return { values, index };
                });
            });
        const search = propertySearch(generator, new Random(xoroshiro128plus(42)), generatorContext(8, 3, 100_000), 1);
        for (let trial = 0; trial < 30; trial += 1) {
            const candidate = search.next();
            const value = candidate.input.reconstruct();
            scope.assert.true(value.index >= 0 && value.index < value.values.length);
            search.accept(candidate, new Map([ [ 'length', value.values.length ] ]));
        }
        return scope.assert.collect();
    }),
    test('retained search inputs reconstruct fresh mutable graphs', function (scope) {
        const search = propertySearch(
            gen.array(gen.integer({ min: 0, max: 100 }), { minLength: 2, maxLength: 8 }),
            new Random(xoroshiro128plus(42)),
            generatorContext(8, 3, 100_000),
            1
        );
        const candidate = search.next();
        const expected = candidate.input.reconstruct();
        const mutated = candidate.input.reconstruct();
        mutated.length = 0;
        search.accept(candidate, new Map([ [ 'length', expected.length ] ]));
        scope.assert.deepEqual(candidate.input.reconstruct(), expected);
        scope.assert.true(search.next().input.reconstruct().length >= 2);
        return scope.assert.collect();
    }),
    test('bounds search on constant mapped outputs', function (scope) {
        const search = propertySearch(
            gen.integer({ min: 0, max: 100 }).map(function constant() {
                return 1;
            }),
            new Random(xoroshiro128plus(42)),
            generatorContext(8, 3, 100),
            1
        );
        scope.assert.throws(function exhaust() {
            for (let trial = 0; trial < 1000; trial += 1) {
                const candidate = search.next();
                search.accept(candidate, new Map([ [ 'constant', candidate.input.reconstruct() ] ]));
            }
        }, { message: /work exhausted/ });
        return scope.assert.collect();
    }),
    test('records trial maxima and expires observations', function (scope) {
        const targets = trialTargets(propertyLabels(1));
        targets.target('distance', -5);
        targets.target('distance', -10);
        scope.assert.equal(targets.finish().get('distance'), -5);
        scope.assert.throws(function expired() {
            targets.target('distance', 0);
        }, { message: /outlived/ });
        return scope.assert.collect();
    }),
    test('rejects invalid scores and shared label overflow', function (scope) {
        const labels = propertyLabels(1);
        labels('coverage');
        const targets = trialTargets(labels);
        scope.assert.throws(function invalid() {
            targets.target('coverage', Number.NaN);
        }, { message: /finite/ });
        scope.assert.throws(function overflow() {
            targets.target('score', 1);
        }, { message: /limit/ });
        return scope.assert.collect();
    }),
    test('scores change deterministic exploration while preserving domains', function (scope) {
        const ascending = searchSequence(1);
        scope.assert.deepEqual(ascending, searchSequence(1));
        scope.assert.notDeepEqual(ascending, searchSequence(-1));
        scope.assert.true(ascending.every(function valid(value) {
            return value >= -1000 && value <= 1000;
        }));
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);
