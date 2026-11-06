import type { PropertyWitnessFile } from '../engine/witness-file.ts';
import { serializeValue, type TestScope, type RunResult } from '../packages/engine/engine.entry-point.ts';
import { suite, test } from '../packages/test/test.entry-point.ts';
import { executePropertyNode, propertyExecutionDefaults } from '../test-support/property-execution.ts';
import { property, withProperties } from './property-authoring.ts';
import { gen } from './generators.ts';
import { relation } from './relation.ts';

function confirmedRelationWitness(scope: TestScope, result: RunResult): PropertyWitnessFile {
    const evidence = result.perTest[0]?.property?.invocations[0];
    scope.assert.equal(result.summary.failed, 1);
    scope.assert.equal(JSON.stringify(evidence?.retained?.input), JSON.stringify(serializeValue(0)));
    const witness = evidence?.confirmedWitness;
    scope.require.defined(witness);
    return witness;
}

export const testNode = suite('metamorphic relations', [
    test('shrinks original inputs and replays the relation without generation', async function (scope: TestScope) {
        let transformations = 0;
        const node = property({
            title: 'failing relation',
            generator: gen.integer({ min: 0, max: 100 }),
            examples: [ function () {
                return 100;
            } ],
            test: relation({
                transform(value: number) {
                    transformations += 1;
                    return value + 1;
                },
                run: Number,
                check({ original, transformed }, sample) {
                    sample.failureKey('unequal');
                    sample.assert.equal(original.output, transformed.output);
                    return sample.assert.collect();
                }
            })
        });
        const result = await executePropertyNode(node, propertyExecutionDefaults);
        const witness = confirmedRelationWitness(scope, result);
        transformations = 0;
        const replayed = await executePropertyNode(node, { ...propertyExecutionDefaults, replay: witness });
        scope.assert.equal(replayed.summary.failed, 1);
        scope.assert.equal(transformations, 1);
        return scope.assert.collect();
    }),
    test('awaits callbacks in order and exposes mutated independent inputs', async function (scope: TestScope) {
        const steps: string[] = [];
        const node = property({
            title: 'sorting relation',
            generator: gen.constant(null).map(function () {
                return [ 2, 1 ];
            }),
            test: relation({
                async transform(values) {
                    await Promise.resolve();
                    steps.push('transform');
                    return values.toReversed();
                },
                async run(values, sample) {
                    await Promise.resolve();
                    steps.push('run');
                    sample.cleanup(function () {
                        steps.push('cleanup');
                    });
                    values.sort(function (left, right) {
                        return left - right;
                    });
                    return values.join(',');
                },
                check({ original, transformed }, sample) {
                    steps.push('check');
                    sample.assert.equal(original.output, transformed.output);
                    sample.assert.deepEqual(original.input, [ 1, 2 ]);
                    sample.assert.equal(original.input === transformed.input, false);
                    return sample.assert.collect();
                }
            })
        });
        const result = await executePropertyNode(node, {
            ...propertyExecutionDefaults,
            policy: { ...propertyExecutionDefaults.policy, newTrials: 1 }
        });
        scope.assert.equal(result.summary.passed, 1);
        scope.assert.deepEqual(steps, [ 'transform', 'run', 'run', 'check', 'cleanup', 'cleanup' ]);
        return scope.assert.collect();
    }),
    test('nested relations preserve one boundary assertion', async function (scope: TestScope) {
        const result = await executePropertyNode(
            test(
                'nested relation',
                withProperties(async function (sample) {
                    sample.plan(1);
                    await sample.forall(
                        gen.integer({ min: 1, max: 10 }),
                        relation({
                            transform(value) {
                                return -value;
                            },
                            run: Math.abs,
                            check({ original, transformed }, trial) {
                                trial.assert.equal(original.output, transformed.output);
                                return trial.assert.collect();
                            }
                        })
                    );
                    return sample.assert.collect();
                })
            ),
            propertyExecutionDefaults
        );
        scope.assert.equal(result.summary.passed, 1);
        return scope.assert.collect();
    }),
    test('operation errors stop the remaining callbacks', async function (scope: TestScope) {
        let checks = 0;
        const result = await executePropertyNode(
            property({
                title: 'throwing operation',
                generator: gen.constant(1),
                test: relation({
                    transform(value) {
                        return value;
                    },
                    run() {
                        throw new Error('operation failed');
                    },
                    check(_observations, sample) {
                        checks += 1;
                        return sample.assert.collect();
                    }
                })
            }),
            propertyExecutionDefaults
        );
        scope.assert.equal(result.summary.failed, 1);
        scope.assert.equal(checks, 0);
        return scope.assert.collect();
    })
]);
