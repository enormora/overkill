import { runIfMain } from '#test-runner';
import { suite, test } from '../packages/test/test.entry-point.ts';
import { serializeValue } from '../packages/engine/engine.entry-point.ts';
import { executePropertyNode, propertyExecutionDefaults } from '../test-support/property-execution.ts';
import { property } from './property-authoring.ts';
import { gen } from './generators.ts';

export const testNode = suite('shrink lifecycle', [
    test('reconstructs mutable mapped inputs for confirmation and every candidate', async function (scope) {
        const seen: number[] = [];
        const result = await executePropertyNode(
            property({
                title: 'fresh shrinking inputs',
                generator: gen.integer({ min: 100, max: 1000 }).map(function fresh(value) {
                    return new Map([ [ 'value', value ] ]);
                }),
                test(input, sample) {
                    const value = input.get('value') ?? -1;
                    seen.push(value);
                    sample.assert.true(value < 100);
                    input.set('value', -1);
                    return sample.assert.collect();
                }
            }),
            propertyExecutionDefaults
        );
        scope.assert.equal(result.summary.failed, 1);
        scope.assert.true(seen.every(function valid(value) {
            return value >= 100;
        }));
        scope.assert.true(seen.length >= 2);
        scope.assert.equal(
            JSON.stringify(result.perTest[0]?.property?.invocations[0]?.retained.input),
            JSON.stringify(serializeValue(new Map([ [ 'value', 100 ] ])))
        );
        return scope.assert.collect();
    }),
    test('cleanup failure stops shrinking with its native outcome', async function (scope) {
        const seen: number[] = [];
        const result = await executePropertyNode(
            property({
                title: 'native cleanup',
                generator: gen.integer({ min: 0, max: 100 }),
                examples: [ function () {
                    return 100;
                } ],
                test(value, sample) {
                    seen.push(value);
                    sample.cleanup(function cleanup() {
                        if (value < 100) {
                            throw new Error('candidate cleanup failed');
                        }
                    });
                    sample.assert.fail({ message: 'original failure' });
                    return sample.assert.collect();
                }
            }),
            propertyExecutionDefaults
        );
        scope.assert.deepEqual(seen, [ 100, 100, 0 ]);
        scope.assert.includes(JSON.stringify(result.perTest[0]?.outcome), 'cleanup-error');
        scope.assert.equal(
            JSON.stringify(result.perTest[0]?.property?.invocations[0]?.retained.input),
            JSON.stringify(serializeValue(100))
        );
        return scope.assert.collect();
    }),
    test('failure keys expire when the invocation completes', async function (scope) {
        let declareFailure: (key: string) => void = function () {
            throw new Error('Key setter was not captured.');
        };
        const result = await executePropertyNode(
            property({
                title: 'key lifetime',
                generator: gen.constant(1),
                test(value, sample) {
                    declareFailure = sample.failureKey;
                    sample.failureKey('trial');
                    sample.assert.equal(value, 1);
                    return sample.assert.collect();
                }
            }),
            propertyExecutionDefaults
        );
        scope.assert.equal(result.summary.passed, 1);
        scope.assert.throws(function expiredKey() {
            declareFailure('late');
        }, { message: 'Failure keys require a nonblank string within an active trial.' });
        return scope.assert.collect();
    })
]);

await runIfMain(import.meta, testNode);
