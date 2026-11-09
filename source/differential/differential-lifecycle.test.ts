import { runIfMain } from '#test-runner';
import { suite, test } from '../packages/test/test.entry-point.ts';
import { gen, property, type PropertySampleScope } from '../packages/property/property.entry-point.ts';
import { differential } from '../packages/differential/differential.entry-point.ts';
import { executePropertyNode, propertyExecutionDefaults } from '../test-support/property-execution.ts';

export const testNode = suite('differential lifecycle', [
    test('require signals stop execution instead of becoming comparable errors', async function (scope) {
        let later = 0;
        const result = await executePropertyNode(
            property({
                title: 'require',
                generator: gen.constant<number>(1),
                async test(value, sample: PropertySampleScope<number>) {
                    return differential<number, number>({
                        implementations: [
                            {
                                name: 'require',
                                run(input) {
                                    sample.require.string(input);
                                    return input;
                                }
                            },
                            {
                                name: 'later',
                                run(input) {
                                    later += 1;
                                    return input;
                                }
                            }
                        ],
                        check(_observations, trial) {
                            later += 1;
                            return trial.assert.collect();
                        }
                    })(value, sample);
                }
            }),
            propertyExecutionDefaults
        );
        scope.assert.equal(later, 0);
        scope.assert.equal(result.summary.failed, 1);
        return scope.assert.collect();
    }),
    test('cancellation after settlement prevents comparison and later implementations', async function (scope) {
        let later = 0;
        const controller = new AbortController();
        const body = differential<number, number>({
            implementations: [
                {
                    name: 'cancel',
                    run(value) {
                        controller.abort(new Error('stopped'));
                        return value;
                    }
                },
                {
                    name: 'later',
                    run(value) {
                        later += 1;
                        return value;
                    }
                }
            ],
            check(_observations, sample) {
                later += 1;
                return sample.assert.collect();
            }
        });
        const result = await executePropertyNode(
            property({
                title: 'cancel',
                generator: gen.constant<number>(1),
                async test(value, sample) {
                    return body(value, { ...sample, signal: controller.signal });
                }
            }),
            propertyExecutionDefaults
        );
        scope.assert.equal(later, 0);
        scope.assert.equal(result.summary.passed, 0);
        return scope.assert.collect();
    }),
    test('reconstruction errors remain failures before implementation execution', async function (scope) {
        let calls = 0;
        const result = await executePropertyNode(
            property({
                title: 'reconstruction',
                generator: gen.constant<number>(1),
                test: differential<number, number>({
                    implementations: [
                        {
                            name: 'one',
                            run(value) {
                                calls += 1;
                                return value;
                            }
                        },
                        {
                            name: 'two',
                            run(value) {
                                calls += 1;
                                return value;
                            }
                        }
                    ],
                    check(_observations, sample) {
                        return sample.assert.collect();
                    }
                })
            }),
            { ...propertyExecutionDefaults, policy: { ...propertyExecutionDefaults.policy, maxWork: 1 } }
        );
        scope.assert.equal(calls, 0);
        scope.assert.equal(result.summary.passed, 0);
        return scope.assert.collect();
    }),
    test('a comparison without assertions fails its contract', async function (scope) {
        const result = await executePropertyNode(
            property({
                title: 'empty check',
                generator: gen.constant(false),
                test: differential<boolean, boolean>({
                    implementations: [
                        {
                            name: 'one',
                            run(value) {
                                return value;
                            }
                        },
                        {
                            name: 'two',
                            run(value) {
                                return value;
                            }
                        }
                    ],
                    check(_observations, sample) {
                        return sample.assert.collect();
                    }
                })
            }),
            propertyExecutionDefaults
        );
        scope.assert.equal(result.summary.passed, 0);
        return scope.assert.collect();
    })
]);

await runIfMain(import.meta, testNode);
