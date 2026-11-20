import { table, type TestNode, suite, test } from '@overkill-dev/test';

import { gen, property } from '../packages/property/property.entry-point.ts';
import { differential } from '../packages/differential/differential.entry-point.ts';
import { executePropertyNode, propertyExecutionDefaults } from '../test-support/property-execution.ts';

export const testNode: TestNode = suite('differential contract', [
    test(
        'preserves thrown identity and shallowly freezes observation containers',
        async function (scope) {
            const thrown: unknown = { expected: true };
            const result = await executePropertyNode(
                property({
                    title: 'outcomes',
                    generator: gen.record({ value: gen.constant(1) }),
                    test: differential({
                        implementations: [
                            {
                                name: 'returned',
                                run(input) {
                                    return input;
                                }
                            },
                            {
                                name: 'thrown',
                                run() {
                                    throw thrown;
                                }
                            },
                            {
                                name: 'rejected',
                                async run() {
                                    throw thrown;
                                }
                            }
                        ],
                        check(observations, sample) {
                            sample.assert.true(Object.isFrozen(observations));
                            for (const observation of observations) {
                                sample.assert.true(Object.isFrozen(observation));
                                sample.assert.true(Object.isFrozen(observation.outcome));
                                sample.assert.false(Object.isFrozen(observation.input));
                                if (observation.outcome.kind === 'threw') {
                                    sample.assert.true(observation.outcome.error === thrown);
                                } else {
                                    sample.assert.true(observation.outcome.value === observation.input);
                                }
                            }
                            sample.assert.deepEqual(
                                observations.map(function outcome(observation) {
                                    return observation.outcome.kind;
                                }),
                                [ 'returned', 'threw', 'threw' ]
                            );
                            return sample.assert.collect();
                        }
                    })
                }),
                propertyExecutionDefaults
            );
            scope.assert.equal(result.summary.passed, 1);
            return scope.assert.collect();
        }
    ),
    table({
        title: 'comparison errors remain body errors',
        cases: [ 'sync', 'async' ] as const,
        caseTitle(mode) {
            return mode;
        },
        async test(scope) {
            const require: typeof scope.require = scope.require;

            function fail(): never {
                throw new Error('comparison failed');
            }
            const result = await executePropertyNode(
                property({
                    title: 'check errors',
                    generator: gen.constant(1),
                    test: differential<number, number>({
                        implementations: [
                            { name: 'one', run: Number },
                            { name: 'two', run: Number }
                        ],
                        check: scope.parameters === 'sync' ? fail : async function failAsynchronously() {
                            await Promise.resolve();
                            return fail();
                        }
                    })
                }),
                propertyExecutionDefaults
            );
            scope.assert.equal(result.summary.failed, 1);
            const outcome = result.perTest[0]?.outcome;
            require.defined(outcome);
            if (outcome.kind !== 'fail') {
                throw new Error('Expected failure.');
            }
            scope.assert.true(outcome.failures.some(function bodyError(failure) {
                return failure.kind === 'body-error' && failure.error.message === 'comparison failed';
            }));
            return scope.assert.collect();
        }
    }),
    table({
        title: 'cancellation stops callbacks',
        cases: [ 'before', 'reconstruction', 'settlement', 'comparison' ] as const,
        caseTitle(phase) {
            return phase;
        },
        async test(scope) {
            const events: string[] = [];
            const controller = new AbortController();
            function cancel(): void {
                controller.abort(new Error('cancel differential'));
            }
            if (scope.parameters === 'before') {
                cancel();
            }
            const result = await executePropertyNode(
                property({
                    title: 'cancel boundaries',
                    generator: gen.constant(1),
                    async test(value, sample) {
                        sample.cleanup(function cleanup() {
                            events.push('cleanup');
                        });
                        return await differential<number, number>({
                            implementations: [
                                {
                                    name: 'first',
                                    async run(input) {
                                        events.push('first');
                                        await Promise.resolve();
                                        if (scope.parameters === 'settlement') {
                                            cancel();
                                        }
                                        return input;
                                    }
                                },
                                {
                                    name: 'second',
                                    run(input) {
                                        events.push('second');
                                        return input;
                                    }
                                }
                            ],
                            async check(_observations, trial) {
                                events.push('check');
                                await Promise.resolve();
                                cancel();
                                trial.assert.true(true);
                                return trial.assert.collect();
                            }
                        })(value, {
                            ...sample,
                            signal: controller.signal,
                            reconstructInput() {
                                events.push('reconstruct');
                                const input = sample.reconstructInput();
                                if (scope.parameters === 'reconstruction') {
                                    cancel();
                                }
                                return input;
                            }
                        });
                    }
                }),
                {
                    ...propertyExecutionDefaults,
                    policy: { ...propertyExecutionDefaults.policy, newTrials: 1, maxShrinkWork: 0 }
                }
            );
            const expected = {
                before: [ 'cleanup' ],
                reconstruction: [ 'reconstruct', 'cleanup' ],
                settlement: [ 'reconstruct', 'first', 'cleanup' ],
                comparison: [ 'reconstruct', 'first', 'reconstruct', 'second', 'check', 'cleanup' ]
            }[scope.parameters];
            scope.assert.deepEqual(events, expected);
            scope.assert.equal(result.summary.failed, 1);
            return scope.assert.collect();
        }
    }),
    test('identical errors without comparison assertions fail the contract', async function (scope) {
        function fail(): never {
            throw new Error('expected error');
        }
        const result = await executePropertyNode(
            property({
                title: 'errors need comparison',
                generator: gen.constant(1),
                test: differential<number, never>({
                    implementations: [ { name: 'one', run: fail }, { name: 'two', run: fail } ],
                    check(_observations, sample) {
                        return sample.assert.collect();
                    }
                })
            }),
            propertyExecutionDefaults
        );
        scope.assert.equal(result.summary.failed, 1);
        return scope.assert.collect();
    })
]);
