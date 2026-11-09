import { runIfMain } from '#test-runner';
import type { RunResult, PropertyWitnessFile } from '../packages/engine/engine.entry-point.ts';
import { suite, test } from '../packages/test/test.entry-point.ts';
import { gen, property, withProperties } from '../packages/property/property.entry-point.ts';
import { differential } from '../packages/differential/differential.entry-point.ts';
import { executePropertyNode, propertyExecutionDefaults } from '../test-support/property-execution.ts';
import { testNode as lifecycleTestNode } from './differential-lifecycle.test.ts';

function confirmedWitness(result: RunResult): PropertyWitnessFile {
    const witness = result.perTest[0]?.property?.invocations[0]?.confirmedWitness;
    if (witness === null || witness === undefined) {
        throw new Error('Expected a confirmed witness.');
    }
    return witness;
}

export const testNode = suite('differential comparisons', [
    lifecycleTestNode,
    test('rejects malformed JavaScript declarations before executing callbacks', function (scope) {
        const run = function (): number {
            return 1;
        };
        const check = function (): never {
            throw new Error('must not run');
        };
        const invalid = [
            null,
            {},
            { implementations: [], check },
            { implementations: [ { name: 'one', run } ], check },
            { implementations: [ { name: 'same', run }, { name: 'same', run } ], check },
            { implementations: [ { name: ' ', run }, { name: 'two', run } ], check },
            { implementations: [ { name: 'one', run: 1 }, { name: 'two', run } ], check }
        ];
        for (const definition of invalid) {
            scope.assert.throws(function () {
                Reflect.apply(differential, undefined, [ definition ]);
            }, { type: TypeError });
        }
        return scope.assert.collect();
    }),
    test('snapshots definitions and replays a retained mismatch', async function (scope) {
        const implementations = [
            {
                name: 'one',
                run(value: number) {
                    return value;
                }
            },
            {
                name: 'two',
                run(value: number) {
                    return value + 1;
                }
            }
        ] as const;
        const body = differential<number, number>({
            implementations,
            check(observations, sample) {
                sample.assert.deepEqual(observations[0].outcome, observations[1].outcome);
                return sample.assert.collect();
            }
        });
        Object.assign(implementations[1], {
            name: 'changed',
            run() {
                return 0;
            }
        });
        const node = property({ title: 'snapshot', generator: gen.integer({ min: 0, max: 10 }), test: body });
        const result = await executePropertyNode(node, propertyExecutionDefaults);
        const witness = confirmedWitness(result);
        const replay = await executePropertyNode(node, { ...propertyExecutionDefaults, replay: witness });
        scope.assert.equal(replay.summary.failed, 1);
        return scope.assert.collect();
    }),
    test('isolates mutable graphs and preserves aliases in declaration order', async function (scope) {
        const calls: string[] = [];
        const result = await executePropertyNode(
            property({
                title: 'isolated',
                generator: gen.constant(null).map(function freshGraph() {
                    const shared = { value: 0 };
                    return { left: shared, right: shared };
                }),
                test: differential({
                    implementations: [
                        {
                            name: 'mutating',
                            run(input) {
                                calls.push('first');
                                Object.assign(input.left, { value: 4 });
                                return input.right.value;
                            }
                        },
                        {
                            name: 'fresh',
                            async run(input) {
                                calls.push('second');
                                return input.right.value;
                            }
                        },
                        {
                            name: 'third',
                            run(input) {
                                calls.push('third');
                                return input.left.value;
                            }
                        }
                    ],
                    check(observations, sample) {
                        sample.assert.equal(observations[0].input.left === observations[0].input.right, true);
                        sample.assert.equal(observations[0].input === observations[1].input, false);
                        sample.assert.deepEqual(
                            observations.map(function outcome(observation) {
                                return observation.outcome;
                            }),
                            [
                                { kind: 'returned', value: 4 },
                                { kind: 'returned', value: 0 },
                                { kind: 'returned', value: 0 }
                            ]
                        );
                        sample.assert.deepEqual(Array.from(calls), [ 'first', 'second', 'third' ]);
                        calls.length = 0;
                        return sample.assert.collect();
                    }
                })
            }),
            propertyExecutionDefaults
        );
        scope.assert.equal(result.summary.passed, 1);
        return scope.assert.collect();
    }),
    test('captures synchronous throws and asynchronous rejections', async function (scope) {
        const result = await executePropertyNode(
            property({
                title: 'errors',
                generator: gen.constant(1),
                test: differential<number, never>({
                    implementations: [
                        {
                            name: 'sync',
                            run() {
                                throw new Error('expected error');
                            }
                        },
                        {
                            name: 'async',
                            async run() {
                                throw new Error('expected error');
                            }
                        }
                    ],
                    check(observations, sample) {
                        for (const observation of observations) {
                            sample.assert.equal(observation.outcome.kind, 'threw');
                            if (observation.outcome.kind === 'threw') {
                                const { error } = observation.outcome;
                                sample.assert.equal(error instanceof Error ? error.message : null, 'expected error');
                            }
                        }
                        return sample.assert.collect();
                    }
                })
            }),
            propertyExecutionDefaults
        );
        scope.assert.equal(result.summary.passed, 1);
        return scope.assert.collect();
    }),
    test('shrinks mismatches and retains a replayable witness', async function (scope) {
        const result = await executePropertyNode(
            property({
                title: 'mismatch',
                generator: gen.integer({ min: 1, max: 100 }),
                test: differential<number, number>({
                    implementations: [
                        {
                            name: 'original',
                            run(value) {
                                return value;
                            }
                        },
                        {
                            name: 'changed',
                            run(value) {
                                return value + 1;
                            }
                        }
                    ],
                    check(observations, sample) {
                        sample.assert.deepEqual(observations[0].outcome, observations[1].outcome);
                        return sample.assert.collect();
                    }
                })
            }),
            propertyExecutionDefaults
        );
        scope.assert.equal(result.summary.failed, 1);
        scope.assert.defined(result.perTest[0]?.property?.invocations[0]?.confirmedWitness);
        return scope.assert.collect();
    }),
    test('preserves permission denials and skips remaining callbacks', async function (scope) {
        let laterCalls = 0;
        const result = await executePropertyNode(
            property({
                title: 'denied',
                generator: gen.constant(1),
                test: differential<number, number>({
                    implementations: [
                        {
                            name: 'denied',
                            run() {
                                throw Object.assign(new Error('denied'), { code: 'ERR_ACCESS_DENIED' });
                            }
                        },
                        {
                            name: 'later',
                            run() {
                                laterCalls += 1;
                                return 1;
                            }
                        }
                    ],
                    check(_observations, sample) {
                        laterCalls += 1;
                        return sample.assert.collect();
                    }
                })
            }),
            propertyExecutionDefaults
        );
        scope.assert.equal(laterCalls, 0);
        scope.assert.equal(result.summary.passed, 0);
        scope.assert.equal(
            result.runnerErrors.some(function permission(error) {
                return error.subtype === 'permission';
            }),
            true
        );
        return scope.assert.collect();
    }),
    test('supports nested property composition', async function (scope) {
        const result = await executePropertyNode(
            test(
                'nested',
                withProperties(async function (sample) {
                    return await sample.forall(
                        gen.constant(0),
                        differential<number, number>({
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
                            check(observations, trial) {
                                trial
                                    .assert
                                    .deepEqual(observations[0].outcome, observations[1].outcome);
                                return trial.assert.collect();
                            }
                        })
                    );
                })
            ),
            propertyExecutionDefaults
        );
        scope.assert.equal(result.summary.passed, 1);
        return scope.assert.collect();
    })
]);

await runIfMain(import.meta, testNode);
