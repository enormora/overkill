import { runIfMain } from '#test-runner';
import { suite, test } from '../packages/test/test.entry-point.ts';
import { executePropertyNode, propertyExecutionDefaults } from '../test-support/property-execution.ts';
import type { PropertyInvocation } from '../packages/property/property.entry-point.ts';
import type { PropertyWitnessFile } from '../engine/witness-file.ts';
import { emptyPropertyCorpus } from '../engine/property-corpus.ts';
import { withProperties } from './property-authoring.ts';
import { gen } from './generators.ts';

async function nestedWitness(): Promise<PropertyWitnessFile> {
    const result = await executePropertyNode(
        test(
            'keyed regression',
            withProperties(async function (parent) {
                return await parent.forall({
                    key: 'stable',
                    generator: gen.constant(42),
                    test(value, sample) {
                        sample.assert.equal(value, 0);
                        return sample.assert.collect();
                    }
                });
            })
        ),
        propertyExecutionDefaults
    );
    const witness = result.perTest[0]?.property?.invocations[0]?.confirmedWitness;
    if (witness === null || witness === undefined) {
        throw new Error('Expected confirmed nested witness.');
    }
    return witness;
}

export const testNode = suite('property corpus invocation targets', [
    test('direct nested replay substitutes only the keyed target', async function (scope) {
        const saved = await nestedWitness();
        const values: number[] = [];
        const result = await executePropertyNode(
            test(
                'keyed regression',
                withProperties(async function (parent) {
                    parent.cleanup(function finishCase() {
                        values.push(99);
                    });
                    await parent.forall({
                        generator: gen.constant(7),
                        test(value, sample) {
                            values.push(value);
                            sample.assert.equal(value, 7);
                            return sample.assert.collect();
                        }
                    });
                    await parent.forall({
                        key: 'stable',
                        generator: gen.constant(0),
                        test(value, sample) {
                            values.push(value);
                            sample.assert.equal(value, 42);
                            return sample.assert.collect();
                        }
                    });
                    values.push(88);
                    return parent.assert.collect();
                })
            ),
            { ...propertyExecutionDefaults, replay: saved }
        );
        scope.assert.equal(result.summary.passed, 1);
        scope.assert.equal(
            values
                .filter(function isTarget(value) {
                    return value === 42;
                })
                .length,
            1
        );
        scope.assert.equal(values[0], 7);
        scope.assert.deepEqual(values.slice(-3), [ 42, 88, 99 ]);
        return scope.assert.collect();
    }),
    test('retains enclosing body errors alongside an unreached replay target', async function (scope) {
        const saved = await nestedWitness();
        const result = await executePropertyNode(
            test(
                'keyed regression',
                withProperties(function () {
                    throw new Error('setup failed before target');
                })
            ),
            { ...propertyExecutionDefaults, replay: saved }
        );
        scope.assert.includes(JSON.stringify(result.perTest), 'setup failed before target');
        scope.assert.true(result.runnerErrors.some(function replayError(error) {
            return error.subtype === 'witness-replay';
        }));
        return scope.assert.collect();
    }),
    test('rejects a duplicate replay key after substituting its first occurrence', async function (scope) {
        const saved = await nestedWitness();
        const inputs: number[] = [];
        const result = await executePropertyNode(
            test(
                'keyed regression',
                withProperties(async function (parent) {
                    for (let occurrence = 0; occurrence < 2; occurrence += 1) {
                        await parent.forall({
                            key: 'stable',
                            generator: gen.constant(0),
                            test(value, sample) {
                                inputs.push(value);
                                sample
                                    .assert
                                    .equal(value, 42);
                                return sample.assert.collect();
                            }
                        });
                    }
                    return parent.assert.collect();
                })
            ),
            { ...propertyExecutionDefaults, replay: saved }
        );
        scope.assert.deepEqual(inputs, [ 42 ]);
        scope.assert.true(result.runnerErrors.some(function replayError(error) {
            return error.subtype === 'witness-replay';
        }));
        return scope.assert.collect();
    }),
    test('replays explicit keys after their source location changes', async function (scope) {
        const saved = await nestedWitness();
        const inputs: number[] = [];
        const result = await executePropertyNode(
            test(
                'keyed regression',
                withProperties(async function (parent) {
                    return await parent.forall({
                        key: 'stable',
                        generator: gen.constant(0),
                        test(value, sample) {
                            inputs.push(value);
                            sample
                                .assert
                                .equal(value, 0);
                            return sample.assert.collect();
                        }
                    });
                })
            ),
            { ...propertyExecutionDefaults, corpus: { ...emptyPropertyCorpus, checkedIn: [ saved ] } }
        );
        scope.assert.equal(result.summary.failed, 1);
        scope.assert.deepEqual(inputs, [ 42, 42 ]);
        return scope.assert.collect();
    }),
    test('fails missing checked-in targets and diagnoses missing local targets', async function (scope) {
        const saved = await nestedWitness();
        const node = test(
            'keyed regression',
            withProperties(function (parent) {
                parent.assert.true(true);
                return parent.assert.collect();
            })
        );
        const checkedIn = await executePropertyNode(node, {
            ...propertyExecutionDefaults,
            corpus: { ...emptyPropertyCorpus, checkedIn: [ saved ] }
        });
        const local = await executePropertyNode(node, {
            ...propertyExecutionDefaults,
            corpus: { ...emptyPropertyCorpus, localCache: [ saved ] }
        });
        scope.assert.equal(checkedIn.summary.failed, 1);
        scope.assert.includes(JSON.stringify(checkedIn), 'target was not reached');
        scope.assert.equal(local.summary.passed, 1);
        scope.assert.includes(JSON.stringify(local), 'Skipped incompatible local corpus invocation target');
        return scope.assert.collect();
    }),
    test('rejects duplicate explicit invocation keys', async function (scope) {
        const result = await executePropertyNode(
            test(
                'duplicate keys',
                withProperties(async function (parent) {
                    const invocation: PropertyInvocation<number> = {
                        key: 'stable',
                        generator: gen.constant<number>(0),
                        test(value, sample) {
                            sample.assert.equal(value, 0);
                            return sample.assert.collect();
                        }
                    };
                    await parent.forall(invocation);
                    return await parent.forall(invocation);
                })
            ),
            propertyExecutionDefaults
        );
        scope.assert.equal(result.summary.failed, 1);
        scope.assert.includes(JSON.stringify(result), 'keys must be unique');
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);
