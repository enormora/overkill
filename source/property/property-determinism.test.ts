import { runIfMain } from '#test-runner';
import { readPropertyExecutionHost, type TestNode } from '../packages/engine/engine.entry-point.ts';
import { suite, test } from '../packages/test/test.entry-point.ts';
import { executePropertyNode, propertyExecutionDefaults } from '../test-support/property-execution.ts';
import { property, withProperties } from './property-authoring.ts';
import { gen } from './generators.ts';
import { executeProperty, type PropertyRegressionInputs } from './property-execution.ts';

function streamDriver(inputs: PropertyRegressionInputs<number>, recordValue: (value: number) => void): TestNode {
    return test(
        'stable stream',
        withProperties(async function (scope) {
            const result = await executeProperty(
                {
                    coverage: [],
                    generator: gen.integer({ min: 0, max: 10_000 }),
                    examples: [],
                    test(value, sample) {
                        recordValue(value);
                        sample.target('value', value);
                        sample.assert.equal(Number.isSafeInteger(value), true);
                        return sample.assert.collect();
                    }
                },
                inputs,
                { host: readPropertyExecutionHost(scope), signal: scope.signal, identity: 'stable-stream' }
            );
            scope.assert.equal(result.kind, 'completed');
            return scope.assert.collect();
        })
    );
}

function streamProperty(recordValue: (value: number) => void): TestNode {
    return property({
        title: 'stable property',
        generator: gen.integer({ min: 0, max: 10_000 }),
        test(value, sample) {
            recordValue(value);
            sample.assert.equal(Number.isSafeInteger(value), true);
            return sample.assert.collect();
        }
    });
}

function nestedStreamProperty(recordValue: (value: number) => void, includeEarlier: boolean): TestNode {
    return test(
        'stable nested property',
        withProperties(async function (scope) {
            if (includeEarlier) {
                await scope.forall(gen.constant(0), function (value, sample) {
                    sample.assert.equal(value, 0);
                    return sample.assert.collect();
                });
            }
            await scope.forall(gen.integer({ min: 0, max: 10_000 }), function (value, sample) {
                recordValue(value);
                sample.assert.equal(Number.isSafeInteger(value), true);
                return sample.assert.collect();
            });
            return scope.assert.collect();
        })
    );
}

export const testNode = suite('property deterministic streams', [
    test('unrelated nested calls do not reseed a later invocation', async function (scope) {
        const first: number[] = [];
        const second: number[] = [];
        const firstRun = await executePropertyNode(
            nestedStreamProperty(function (value) {
                first.push(value);
            }, false),
            propertyExecutionDefaults
        );
        const secondRun = await executePropertyNode(
            nestedStreamProperty(function (value) {
                second.push(value);
            }, true),
            propertyExecutionDefaults
        );
        scope.assert.equal(firstRun.summary.passed, 1);
        scope.assert.equal(secondRun.summary.passed, 1);
        scope.assert.deepEqual(first, second);
        return scope.assert.collect();
    }),
    test('corpus changes leave new exploration unchanged', async function (scope) {
        const first: number[] = [];
        const second: number[] = [];
        const results = await Promise.all([
            executePropertyNode(
                streamDriver({ checkedIn: [], localCache: [] }, function (value) {
                    first.push(value);
                }),
                propertyExecutionDefaults
            ),
            executePropertyNode(
                streamDriver({
                    checkedIn: [ function () {
                        return -1;
                    } ],
                    localCache: [ function () {
                        return -2;
                    } ]
                }, function (value) {
                    second.push(value);
                }),
                propertyExecutionDefaults
            )
        ]);
        scope.assert.deepEqual(
            results.map(function passed(result) {
                return result.summary.passed;
            }),
            [ 1, 1 ]
        );
        scope.assert.deepEqual(second.slice(0, 2), [ -1, -2 ]);
        scope.assert.deepEqual(first, second.slice(2));
        return scope.assert.collect();
    }),
    test('case scheduling does not perturb generated inputs', async function (scope) {
        const serial: number[] = [];
        const concurrent: number[] = [];
        const first = await executePropertyNode(
            suite('same suite', [ streamProperty(function (value) {
                serial.push(value);
            }) ]),
            propertyExecutionDefaults
        );
        const second = await executePropertyNode(
            suite('same suite', [ streamProperty(function (value) {
                concurrent.push(value);
            }) ]),
            {
                ...propertyExecutionDefaults,
                execution: { mode: 'concurrent-in-process', maxConcurrency: 2 }
            }
        );
        scope.assert.equal(first.summary.passed, 1);
        scope.assert.equal(second.summary.passed, 1);
        scope.assert.deepEqual(serial, concurrent);
        return scope.assert.collect();
    }),
    test('the complete run seed contributes to the exploration stream', async function (scope) {
        const first: number[] = [];
        const second: number[] = [];
        const results = await Promise.all([
            executePropertyNode(
                streamProperty(function (value) {
                    first.push(value);
                }),
                propertyExecutionDefaults
            ),
            executePropertyNode(
                streamProperty(function (value) {
                    second.push(value);
                }),
                {
                    ...propertyExecutionDefaults,
                    seed: 4_294_967_338n
                }
            )
        ]);
        scope.assert.deepEqual(
            results.map(function passed(result) {
                return result.summary.passed;
            }),
            [ 1, 1 ]
        );
        scope.assert.notDeepEqual(first, second);
        return scope.assert.collect();
    })
]);

await runIfMain(import.meta, testNode);
