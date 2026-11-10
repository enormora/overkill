import { runIfMain } from '#test-runner';
import { suite, test } from '../packages/test/test.entry-point.ts';
import { property, gen, withProperties } from '../packages/property/property.entry-point.ts';
import { linearizability } from '../packages/linearizability/linearizability.entry-point.ts';
import { executePropertyNode, propertyExecutionDefaults } from '../test-support/property-execution.ts';

type MutableOperation = { readonly values: ReadonlyMap<string, number>; };

export const testNode = suite('linearizability property composition', [
    test('stops admission immediately on a synchronous fatal control error', async function (scope) {
        const admitted: number[] = [];
        const result = await executePropertyNode(
            property({
                title: 'synchronous fatal call',
                generator: gen.tuple(gen.tuple(gen.constant(0)), gen.tuple(gen.constant(1))),
                test: linearizability({
                    create(sample) {
                        return sample.inconclusive;
                    },
                    run(operation: number, stop: (reason: string) => never) {
                        admitted.push(operation);
                        return stop('Fatal control.');
                    },
                    model: {
                        initial() {
                            return 0;
                        },
                        transition(state) {
                            return { kind: 'enabled', state };
                        }
                    },
                    maxWork: 100
                })
            }),
            propertyExecutionDefaults
        );
        scope.assert.equal(result.summary.inconclusive, 1);
        scope.assert.deepEqual(admitted, [ 0 ]);
        return scope.assert.collect();
    }),
    test('records promise responses before admitting a later call', async function (scope) {
        const result = await executePropertyNode(
            property({
                title: 'promise response precedence',
                generator: gen.tuple(gen.tuple(gen.constant(1)), gen.tuple(gen.constant(2), gen.constant(3))),
                test: linearizability({
                    create() {
                        return null;
                    },
                    run(operation: number): Promise<number> | number {
                        return operation === 1 ? Promise.resolve(0) : 0;
                    },
                    model: {
                        initial() {
                            return 0;
                        },
                        transition(state, observation) {
                            if (observation.operation === 1) {
                                return { kind: 'enabled', state: 1 };
                            }
                            if (observation.operation === 2) {
                                return { kind: 'enabled', state };
                            }
                            return observation.outcome.kind === 'returned' && observation.outcome.value === state
                                ? { kind: 'enabled', state }
                                : { kind: 'disabled' };
                        }
                    },
                    maxWork: 1000
                })
            }),
            propertyExecutionDefaults
        );
        scope.assert.equal(result.summary.failed, 1);
        scope.assert.equal(result.summary.inconclusive, 0);
        return scope.assert.collect();
    }),
    test('isolates mutable execution inputs from the model', async function (scope) {
        const result = await executePropertyNode(
            property({
                title: 'mutable operation',
                generator: gen.tuple(gen.tuple(
                    gen.record({
                        values: gen.constant(1).map(function (value) {
                            return new Map([ [ 'value', value ] ]);
                        })
                    })
                )),
                test: linearizability({
                    create() {
                        return null;
                    },
                    run(operation: MutableOperation) {
                        const output = operation.values.get('value');
                        if (!(operation.values instanceof Map)) {
                            throw new TypeError('Expected mutable operation storage.');
                        }
                        operation.values.set('value', 99);
                        return output;
                    },
                    model: {
                        initial() {
                            return 0;
                        },
                        transition(state, observation) {
                            const matches = observation.outcome.kind === 'returned' &&
                                observation.operation.values.get('value') === observation.outcome.value;
                            return matches ? { kind: 'enabled', state } : { kind: 'disabled' };
                        }
                    },
                    maxWork: 100
                })
            }),
            propertyExecutionDefaults
        );
        scope.assert.equal(result.summary.passed, 1);
        return scope.assert.collect();
    }),
    test('supports empty programs in nested invocations', async function (scope) {
        const result = await executePropertyNode(
            test(
                'nested empty history',
                withProperties(async function (sample) {
                    return sample.forall(
                        gen.array(gen.array(gen.integer({ min: 0, max: 0 })), { minLength: 0, maxLength: 0 }),
                        linearizability({
                            create() {
                                return null;
                            },
                            run(operation: number) {
                                return operation;
                            },
                            model: {
                                initial() {
                                    return 0;
                                },
                                transition(state) {
                                    return { kind: 'enabled', state };
                                }
                            },
                            maxWork: 100
                        })
                    );
                })
            ),
            propertyExecutionDefaults
        );
        scope.assert.equal(result.summary.passed, 1);
        return scope.assert.collect();
    }),
    test('replays confirmed lane inputs through current system code', async function (scope) {
        const node = property({
            title: 'replay invalid read',
            generator: gen.tuple(gen.tuple(gen.constant(1))),
            test: linearizability({
                create() {
                    return null;
                },
                run(operation: number) {
                    return operation;
                },
                model: {
                    initial() {
                        return 0;
                    },
                    transition() {
                        return { kind: 'disabled' };
                    }
                },
                maxWork: 100
            })
        });
        const failed = await executePropertyNode(node, propertyExecutionDefaults);
        const replay = failed.perTest[0]?.property?.invocations[0]?.confirmedWitness;
        if (replay === undefined || replay === null) {
            throw new Error('Expected a confirmed lane witness.');
        }
        const repeated = await executePropertyNode(node, { ...propertyExecutionDefaults, replay });
        scope.assert.equal(repeated.summary.failed, 1);
        scope.assert.equal(repeated.summary.inconclusive, 0);
        return scope.assert.collect();
    })
]);

await runIfMain(import.meta, testNode);
