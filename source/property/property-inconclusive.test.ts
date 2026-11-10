import { runIfMain } from '#test-runner';
import { suite, test } from '../packages/test/test.entry-point.ts';
import { executePropertyNode, propertyExecutionDefaults } from '../test-support/property-execution.ts';
import { property } from './property-authoring.ts';
import { gen } from './generators.ts';

export const testNode = suite('property inconclusive control', [
    test('expires the inconclusive callback after trial completion', async function (scope) {
        let stop = function (reason: string): never {
            throw new Error(reason);
        };
        await executePropertyNode(
            property({
                title: 'capture control',
                generator: gen.constant(1),
                test(value, sample) {
                    stop = sample.inconclusive;
                    sample.assert.equal(value, 1);
                    return sample.assert.collect();
                }
            }),
            propertyExecutionDefaults
        );
        scope.assert.throws(function () {
            return stop('Expired callback.');
        }, { type: TypeError });
        return scope.assert.collect();
    }),
    test('retains an assertion failure recorded before inconclusive termination', async function (scope) {
        const result = await executePropertyNode(
            property({
                title: 'failure precedence',
                generator: gen.constant(1),
                test(_value, sample) {
                    sample.assert.fail();
                    return sample.inconclusive('Search incomplete.');
                }
            }),
            propertyExecutionDefaults
        );
        scope.assert.equal(result.summary.failed, 1);
        scope.assert.equal(result.summary.inconclusive, 0);
        return scope.assert.collect();
    }),
    test('retains confirmed evidence when reduction becomes inconclusive', async function (scope) {
        let calls = 0;
        const result = await executePropertyNode(
            property({
                title: 'inconclusive reduction',
                generator: gen.integer({ min: 1, max: 10 }),
                test(_value, sample) {
                    calls += 1;
                    if (calls >= 3) {
                        sample.inconclusive('Reduction incomplete.');
                    }
                    sample.assert.fail();
                    return sample.assert.collect();
                }
            }),
            propertyExecutionDefaults
        );
        const evidence = result.perTest[0]?.property?.invocations[0];
        scope.assert.equal(result.summary.failed, 1);
        scope.assert.equal(result.summary.inconclusive, 0);
        scope.assert.equal(evidence?.shrinkStatus, 'interrupted');
        scope.assert.defined(evidence?.confirmedWitness);
        scope.assert.notNull(evidence?.confirmedWitness);
        return scope.assert.collect();
    }),
    test('rejects blank inconclusive reasons as body errors', async function (scope) {
        const result = await executePropertyNode(
            property({
                title: 'invalid reason',
                generator: gen.constant(1),
                test(_value, sample) {
                    return sample.inconclusive(' ');
                }
            }),
            propertyExecutionDefaults
        );
        scope.assert.equal(result.summary.inconclusive, 0);
        const outcome = result.perTest[0]?.outcome;
        if (outcome?.kind !== 'fail') {
            throw new Error('Expected the invalid reason to fail.');
        }
        const failure = outcome.failures[0];
        scope.assert.equal(failure.kind, 'body-error');
        if (failure.kind === 'body-error') {
            scope.assert.equal(failure.error.name, 'TypeError');
        }
        return scope.assert.collect();
    })
]);

await runIfMain(import.meta, testNode);
