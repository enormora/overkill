import { suite, test, table } from '@overkill-dev/test';

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
    test(
        'cancellation after settlement prevents comparison and later implementations',
        async function (scope) {
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
        }
    ),
    test(
        'reconstruction exhaustion remains inconclusive before implementation execution',
        async function (scope) {
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
            scope.assert.equal(result.summary.inconclusive, 1);
            scope.assert.equal(result.summary.failed, 0);
            scope.assert.equal(result.perTest[0]?.property?.invocations[0]?.summary?.status, 'work-exhausted');
            return scope.assert.collect();
        }
    ),
    table({
        title: 'control escapes unchanged',
        cases: ([ 'sync', 'async' ] as const).flatMap(function settlement(mode) {
            return ([ 'require', 'contract', 'inconclusive', 'permission' ] as const).map(function termination(kind) {
                return { mode, kind };
            });
        }),
        caseTitle(parameters) {
            return `${parameters.mode} ${parameters.kind}`;
        },
        async test(scope) {
            const { mode, kind } = scope.parameters;
            const controlFlow = { continued: 0, propagated: 0 };
            const result = await executePropertyNode(
                property({
                    title: 'control',
                    generator: gen.constant<number>(1),
                    async test(value, sample: PropertySampleScope<number>) {
                        let original: unknown = null;
                        function terminate(): never {
                            if (kind === 'inconclusive') {
                                return sample.inconclusive('search incomplete');
                            }
                            if (kind === 'permission') {
                                throw Object.assign(new Error('denied'), { code: 'ERR_ACCESS_DENIED' });
                            }
                            if (kind === 'contract') {
                                sample.plan(-1);
                            }
                            sample.require.string(1);
                            throw new Error('Expected control termination.');
                        }
                        function stop(): never {
                            try {
                                return terminate();
                            } catch (error: unknown) {
                                original = error;
                                throw error;
                            }
                        }
                        const body = differential<number, number>({
                            implementations: [
                                {
                                    name: 'stop',
                                    run: mode === 'sync' ? stop : async function stopAsynchronously() {
                                        await Promise.resolve();
                                        return stop();
                                    }
                                },
                                {
                                    name: 'later',
                                    run(input) {
                                        controlFlow.continued += 1;
                                        return input;
                                    }
                                }
                            ],
                            check(_observations, trial) {
                                controlFlow.continued += 1;
                                return trial.assert.collect();
                            }
                        });
                        try {
                            return await body(value, sample);
                        } catch (error: unknown) {
                            scope.assert.equal(error === original, true);
                            controlFlow.propagated += 1;
                            throw error;
                        }
                    }
                }),
                propertyExecutionDefaults
            );
            scope.assert.equal(controlFlow.continued, 0);
            scope.assert.true(controlFlow.propagated > 0);
            scope.assert.equal(result.summary.inconclusive, kind === 'inconclusive' ? 1 : 0);
            if (kind === 'permission') {
                scope.assert.true(result.runnerErrors.some(function permission(error) {
                    return error.subtype === 'permission';
                }));
            } else {
                scope.assert.equal(result.summary.failed, kind === 'inconclusive' ? 0 : 1);
            }
            return scope.assert.collect();
        }
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
