import { runIfMain } from '#test-runner';
import { suite, test } from '../packages/test/test.entry-point.ts';
import { property, gen } from '../packages/property/property.entry-point.ts';
import { linearizability } from '../packages/linearizability/linearizability.entry-point.ts';
import { executePropertyNode, propertyExecutionDefaults } from '../test-support/property-execution.ts';

type DrainingSystem = {
    readonly stop: (reason: string) => never;
    readonly drain: () => void;
};

export const testNode = suite('concurrent linearizability authoring', [
    ...[ false, true ].map(function (overlap) {
        return test(`checks increment histories with overlap ${overlap}`, async function (scope) {
            const result = await executePropertyNode(
                property({
                    title: 'increments',
                    generator: gen.tuple(gen.tuple(gen.constant(1)), gen.tuple(gen.constant(1))),
                    test: linearizability({
                        maxWork: 1000,
                        create() {
                            return new Map([ [ 'value', 0 ] ]);
                        },
                        run(operation: number, system): Promise<number> | number {
                            const value = system.get('value') ?? operation - 1;
                            if (overlap) {
                                return (async function incrementLater() {
                                    await Promise.resolve();
                                    system.set('value', value + 1);
                                    return value;
                                })();
                            }
                            system.set('value', value + 1);
                            return value;
                        },
                        model: {
                            initial() {
                                return 0;
                            },
                            transition(state, observation) {
                                return observation.outcome.kind === 'returned' && observation.outcome.value === state
                                    ? { kind: 'enabled', state: state + 1 }
                                    : { kind: 'disabled' };
                            }
                        }
                    })
                }),
                propertyExecutionDefaults
            );
            scope.assert.equal(result.summary.failed, overlap ? 1 : 0);
            scope.assert.equal(result.summary.inconclusive, 0);
            return scope.assert.collect();
        });
    }),
    test('records ordinary throws and continues the lane', async function (scope) {
        const result = await executePropertyNode(
            property({
                title: 'expected errors',
                generator: gen.tuple(gen.tuple(gen.constant(1), gen.constant(2))),
                test: linearizability({
                    create() {
                        return null;
                    },
                    run(operation: number) {
                        throw new Error(`Expected system error ${operation}.`);
                    },
                    maxWork: 100,
                    model: {
                        initial() {
                            return 0;
                        },
                        transition(state, observation) {
                            return observation.outcome.kind === 'threw'
                                ? { kind: 'enabled', state: state + 1 }
                                : { kind: 'disabled' };
                        }
                    }
                })
            }),
            propertyExecutionDefaults
        );
        scope.assert.equal(result.summary.failed, 0);
        scope.assert.equal(result.summary.inconclusive, 0);
        return scope.assert.collect();
    }),
    test('drains admitted calls before cleanup after a fatal control error', async function (scope) {
        let clean = false;
        const result = await executePropertyNode(
            property({
                title: 'fatal lane',
                generator: gen.tuple(gen.tuple(gen.constant(1)), gen.tuple(gen.constant(2))),
                test: linearizability({
                    maxWork: 100,
                    model: {
                        initial() {
                            return 0;
                        },
                        transition(state, observation) {
                            return observation.outcome.kind === 'returned'
                                ? { kind: 'enabled', state }
                                : { kind: 'disabled' };
                        }
                    },
                    create(sample): DrainingSystem {
                        let drained = false;
                        sample.cleanup(function () {
                            clean = drained;
                        });
                        return {
                            stop: sample.inconclusive,
                            drain() {
                                drained = true;
                            }
                        };
                    },
                    async run(operation: number, system: DrainingSystem, signal: AbortSignal) {
                        if (operation === 2) {
                            system.stop('Stop concurrent execution.');
                        }
                        try {
                            await new Promise<void>(function (_resolve, reject) {
                                signal.addEventListener('abort', function () {
                                    const reason: unknown = signal.reason;
                                    reject(reason instanceof Error ? reason : new Error('Canceled operation.'));
                                }, { once: true });
                            });
                        } finally {
                            system.drain();
                        }
                        return 0;
                    }
                })
            }),
            propertyExecutionDefaults
        );
        scope.assert.equal(result.summary.failed, 0);
        scope.assert.equal(result.summary.inconclusive, 1);
        scope.assert.true(clean);
        return scope.assert.collect();
    }),
    test('runs lanes concurrently while preserving lane order and fresh systems', async function (scope) {
        let created = 0;
        let cleaned = 0;
        const node = property({
            title: 'concurrent reads',
            generator: gen.tuple(gen.tuple(gen.constant(1), gen.constant(2)), gen.tuple(gen.constant(3))),
            test: linearizability({
                maxWork: 1000,
                model: {
                    initial() {
                        return 0;
                    },
                    transition(state) {
                        return { kind: 'enabled', state };
                    }
                },
                create(sample) {
                    const seen: number[] = [];
                    created += 1;
                    sample.cleanup(function () {
                        cleaned += 1;
                    });
                    return { gate: Promise.withResolvers<undefined>(), seen };
                },
                async run(operation: number, system) {
                    system.seen.push(operation);
                    if (operation === 1) {
                        await system.gate.promise;
                    }
                    if (operation === 3) {
                        system.gate.resolve(undefined);
                    } else if (operation === 2 && system.seen.join(',') !== '1,3,2') {
                        throw new Error('Lane order violated.');
                    }
                    return 0;
                }
            })
        });
        const result = await executePropertyNode(node, propertyExecutionDefaults);
        scope.assert.equal(result.summary.failed, 0);
        scope.assert.equal(result.summary.inconclusive, 0);
        scope.assert.greaterThan(created, 0);
        scope.assert.equal(cleaned, created);
        return scope.assert.collect();
    }),
    ...[ 'linearizable', 'not-linearizable', 'inconclusive' ].map(function (kind) {
        return test(`maps ${kind} verdicts`, async function (scope) {
            const result = await executePropertyNode(
                property({
                    title: 'read consistency',
                    generator: gen.tuple(gen.tuple(gen.constant(0))),
                    test: linearizability({
                        create() {
                            return null;
                        },
                        run() {
                            return kind === 'not-linearizable' ? 1 : 0;
                        },
                        model: {
                            initial() {
                                return 0;
                            },
                            transition(state, observation) {
                                return observation.outcome.kind === 'returned' && observation.outcome.value === state
                                    ? { kind: 'enabled', state }
                                    : { kind: 'disabled' };
                            }
                        },
                        maxWork: kind === 'inconclusive' ? 1 : 100
                    })
                }),
                propertyExecutionDefaults
            );
            scope.assert.equal(result.summary.failed, kind === 'not-linearizable' ? 1 : 0);
            scope.assert.equal(result.summary.inconclusive, kind === 'inconclusive' ? 1 : 0);
            return scope.assert.collect();
        });
    }),
    test('inconclusive confirmation preserves the initial failure', async function (scope) {
        let calls = 0;
        const result = await executePropertyNode(
            property({
                title: 'inconclusive confirmation',
                generator: gen.integer({ min: 0, max: 5 }),
                test(_value, sample) {
                    calls += 1;
                    if (calls > 1) {
                        sample.inconclusive('Unable to complete confirmation.');
                    }
                    sample.assert.fail();
                    return sample.assert.collect();
                }
            }),
            propertyExecutionDefaults
        );
        scope.assert.equal(result.summary.failed, 1);
        scope.assert.equal(result.summary.inconclusive, 0);
        scope.assert.equal(result.perTest[0]?.property?.invocations[0]?.confirmedWitness, null);
        return scope.assert.collect();
    })
]);

await runIfMain(import.meta, testNode);
