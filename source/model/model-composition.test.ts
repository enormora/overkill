import { z } from 'zod/v4';
import type { TestScope } from '../packages/engine/engine.entry-point.ts';
import { suite, test } from '../packages/test/test.entry-point.ts';
import {
    defineCodec,
    gen,
    withProperties
} from '../packages/property/property.entry-point.ts';
import { model, modelScenario, type ModelDefinition } from '../packages/model/model.entry-point.ts';
import { executePropertyNode, propertyExecutionDefaults } from '../test-support/property-execution.ts';

export const testNode = suite('model composition', [
    test('filters disabled operations before executing generated traces', async function (scope: TestScope) {
        const result = await executePropertyNode(
            model({
                title: 'bounded counter',
                settings: {},
                initial() {
                    return 0;
                },
                commands() {
                    return gen.integer({ min: -2, max: 2 });
                },
                transition(state, operation) {
                    const next = state + operation;
                    return next < 0 || next > 2 ? { kind: 'disabled' } : { kind: 'enabled', state: next };
                },
                length: { minLength: 1, maxLength: 5 },
                codec: null,
                examples: [],
                coverage: [],
                create(): number[] {
                    return [];
                },
                run(operation, system) {
                    system.push(operation);
                },
                check(state, system, sample) {
                    sample.assert.between(state, 0, 2);
                    sample.assert.equal(
                        system.reduce(function (total, value) {
                            return total + value;
                        }, 0),
                        state
                    );
                }
            }),
            { ...propertyExecutionDefaults, policy: { ...propertyExecutionDefaults.policy, newTrials: 20 } }
        );
        scope.assert.equal(result.summary.passed, 1);
        return scope.assert.collect();
    }),
    test('supports nested invocations with valid state-dependent traces', async function (scope: TestScope) {
        const scenario = modelScenario({
            initial() {
                return 0;
            },
            commands(state: number) {
                return gen.integer({ min: -state, max: 2 - state });
            },
            transition(state, operation) {
                return { kind: 'enabled', state: state + operation };
            },
            length: { minLength: 1, maxLength: 5 },
            codec: null,
            examples: [],
            coverage: [],
            create(): number[] {
                return [];
            },
            run(operation, system) {
                system.push(operation);
            },
            check(state, system, sample) {
                sample.assert.equal(
                    system.reduce(function (total, value) {
                        return total + value;
                    }, 0),
                    state
                );
                sample.assert.between(state, 0, 2);
            }
        });
        const node = test(
            'nested model',
            withProperties(async function (sample) {
                return await sample.forall(scenario);
            })
        );
        const result = await executePropertyNode(node, propertyExecutionDefaults);
        scope.assert.equal(result.summary.passed, 1);
        return scope.assert.collect();
    }),
    test('supports undefined initial and expected state', async function (scope: TestScope) {
        const result = await executePropertyNode(
            model({
                title: 'undefined model',
                settings: {},
                initial() {
                    return undefined;
                },
                commands() {
                    return gen.constant(null);
                },
                transition() {
                    return { kind: 'enabled', state: undefined };
                },
                length: { minLength: 1, maxLength: 1 },
                codec: null,
                examples: [],
                coverage: [],
                create() {
                    return null;
                },
                run() {
                    return undefined;
                },
                check(state, system, sample) {
                    sample.assert.undefined(state);
                    sample.assert.null(system);
                }
            }),
            propertyExecutionDefaults
        );
        scope.assert.equal(result.summary.passed, 1);
        return scope.assert.collect();
    }),
    test('uses the complete trace codec for replay outside generation bounds', async function (scope: TestScope) {
        const codec = defineCodec<readonly number[]>({
            name: 'model-numbers',
            version: 1,
            previousDecoders: [],
            encode(values) {
                return Array.from(values);
            },
            decode(value) {
                return z.array(z.number()).parse(value);
            }
        });
        const definition: ModelDefinition<number, number, number[]> = {
            title: 'codec model',
            settings: {},
            initial() {
                return 0;
            },
            commands() {
                return gen.integer({ min: 1, max: 5 });
            },
            transition(state: number, operation: number) {
                return { kind: 'enabled', state: state + operation } as const;
            },
            length: { minLength: 1, maxLength: 1 },
            codec,
            examples: [ function () {
                return [ 1, 2, 3 ];
            } ],
            coverage: [],
            create(): number[] {
                return [];
            },
            run(operation, system) {
                system.push(-operation);
            },
            check(state, system, sample) {
                sample.assert.equal(
                    system.reduce(function (total, value) {
                        return total + value;
                    }, 0),
                    state
                );
            }
        };
        const result = await executePropertyNode(model(definition), propertyExecutionDefaults);
        const witness = result.perTest[0]?.property?.invocations[0]?.confirmedWitness;
        scope.require.defined(witness);
        scope.assert.equal(witness.counterexample.codec.name, 'model-numbers');
        const replay = await executePropertyNode(
            model({
                ...definition,
                commands() {
                    throw new Error('No generation');
                }
            }),
            {
                ...propertyExecutionDefaults,
                replay: witness
            }
        );
        scope.assert.equal(replay.summary.failed, 1);
        return scope.assert.collect();
    })
]);
