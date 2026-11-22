import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { suite, test } from '@overkill-dev/test';

import { decodePropertyInput } from '../property/property-graph.ts';

import type { RunResult, PropertyWitnessFile } from '../packages/engine/engine.entry-point.ts';

import { gen, property } from '../packages/property/property.entry-point.ts';
import { model, modelScenario } from '../packages/model/model.entry-point.ts';
import { executePropertyNode, propertyExecutionDefaults } from '../test-support/property-execution.ts';

import type { ModelScenarioDefinition } from './model-definition.ts';

function modelWitness(result: RunResult): PropertyWitnessFile {
    const witness = result.perTest[0]?.property?.invocations[0]?.confirmedWitness;
    if (witness === undefined || witness === null) {
        throw new Error('Expected witness to satisfy defined.');
    }
    return witness;
}

function counter(): ModelScenarioDefinition<number, number, { readonly value: number; }> {
    return {
        initial() {
            return 0;
        },
        commands() {
            return gen.integer({ min: 1, max: 5 });
        },
        transition(state, operation) {
            return { kind: 'enabled', state: state + operation };
        },
        length: { minLength: 1, maxLength: 5 },
        codec: null,
        examples: [],
        coverage: [],
        create() {
            return { value: 0 };
        },
        run(operation, system) {
            Object.assign(system, { value: system.value + operation });
        },
        check(state, system, sample) {
            sample.assert.equal(system.value, state);
        }
    };
}

const pristineModelOperations = defineCompositeAssertion({
    name: 'retains pristine generated operations in the witness',
    assert(check, operations: unknown) {
        if (!Array.isArray(operations)) {
            return check.array(operations);
        }
        return check.group([
            check.between(operations.length, 1, 2),
            ...operations.map(function (operation) {
                const shape = check.group([ check.object(operation), check.hasProperty(operation, 'value') ]);
                const value: unknown = typeof operation === 'object' && operation !== null
                    ? Reflect.get(operation, 'value')
                    : undefined;
                return check.group([
                    shape,
                    typeof value === 'number' ? check.between(value, 1, 5) : check.number(value)
                ]);
            })
        ]);
    }
});
export const testNode = suite('model-based testing', [
    test('reconstruction retains aliases and expires after cleanup', async function (scope) {
        let reconstruct: () => unknown = function () {
            return null;
        };
        let cleanupCopies = 0;
        const result = await executePropertyNode(
            property({
                title: 'input copies',
                generator: gen.constant(null).map(function () {
                    const shared = { value: 1 };
                    return [ shared, shared ];
                }),
                test(input, sample) {
                    reconstruct = sample.reconstructInput;
                    const copy = sample.reconstructInput();
                    sample.assert.equal(copy[0] === copy[1], true);
                    sample.assert.equal(copy[0] === input[0], false);
                    sample.cleanup(function () {
                        sample.reconstructInput();
                        cleanupCopies += 1;
                    });
                    return sample.assert.collect();
                }
            }),
            propertyExecutionDefaults
        );
        scope.assert(
            defineCompositeAssertion({
                name: 'reconstruction retains aliases and expires after cleanup',
                assert(check) {
                    return check.group([
                        check.equal(
                            result
                                .summary
                                .passed,
                            1
                        ),
                        check.equal(cleanupCopies, propertyExecutionDefaults.policy.newTrials),
                        check.throws(reconstruct, {
                            type: TypeError,
                            message: 'Property input reconstruction requires an active trial.'
                        })
                    ]);
                }
            })
        );
        return scope.assert.collect();
    }),
    test('an unreachable minimum remains inconclusive', async function (scope) {
        const result = await executePropertyNode(
            model({
                ...counter(),
                title: 'unreachable length',
                settings: {},
                commands() {
                    return null;
                }
            }),
            propertyExecutionDefaults
        );
        scope.assert.equal(result.summary.inconclusive, 1);
        return scope.assert.collect();
    }),
    test('checks a fresh system and cleans it up for every trial', async function (scope) {
        let created = 0;
        let disposed = 0;
        const result = await executePropertyNode(
            model({
                ...counter(),
                title: 'counter',
                settings: {},
                create(sample) {
                    created += 1;
                    sample.cleanup(function () {
                        disposed += 1;
                    });
                    return { value: 0 };
                }
            }),
            propertyExecutionDefaults
        );
        scope.assert(
            defineCompositeAssertion({
                name: 'checks a fresh system and cleans it up for every trial',
                assert(check) {
                    return check.group([
                        check.equal(
                            result
                                .summary
                                .passed,
                            1
                        ),
                        check.equal(created, propertyExecutionDefaults.policy.newTrials),
                        check.equal(disposed, created)
                    ]);
                }
            })
        );
        return scope.assert.collect();
    }),
    test('confirms failures and replays without command generation', async function (scope) {
        let generated = 0;
        const node = model({
            ...counter(),
            title: 'faulty counter',
            settings: {},
            commands() {
                generated += 1;
                return gen.integer({ min: 1, max: 5 });
            },
            run(_operation, system) {
                Object.assign(system, { value: system.value - 1 });
            }
        });
        const result = await executePropertyNode(node, propertyExecutionDefaults);
        scope.assert.equal(result.summary.failed, 1);
        const witness = modelWitness(result);
        generated = 0;
        const replay = await executePropertyNode(node, { ...propertyExecutionDefaults, replay: witness });
        scope.assert(
            defineCompositeAssertion({
                name: 'confirms failures and replays without command generation',
                assert(check) {
                    return check.group([ check.equal(replay.summary.failed, 1), check.equal(generated, 0) ]);
                }
            })
        );
        return scope.assert.collect();
    }),
    test('rejects invalid examples before creating the system', async function (scope) {
        let created = 0;
        const result = await executePropertyNode(
            model({
                ...counter(),
                title: 'invalid trace',
                settings: {},
                examples: [ function () {
                    return [ -1 ];
                } ],
                transition(state, operation) {
                    return operation < 0 ? { kind: 'disabled' } : { kind: 'enabled', state: state + operation };
                },
                create() {
                    created += 1;
                    return { value: 0 };
                }
            }),
            propertyExecutionDefaults
        );
        scope.assert(
            defineCompositeAssertion({
                name: 'rejects invalid examples before creating the system',
                assert(check) {
                    return check.group([ check.equal(result.summary.failed, 1), check.equal(created, 0) ]);
                }
            })
        );
        return scope.assert.collect();
    }),
    test('isolates model expectations from payload mutation', async function (scope) {
        const result = await executePropertyNode(
            model({
                title: 'mutating system',
                settings: {},
                initial(): readonly { readonly value: number; }[] {
                    return [];
                },
                commands() {
                    return gen.record({ value: gen.integer({ min: 1, max: 5 }) });
                },
                transition(state, operation) {
                    return { kind: 'enabled', state: [ ...state, operation ] };
                },
                length: { minLength: 1, maxLength: 2 },
                codec: null,
                examples: [],
                coverage: [],
                create(): { readonly value: number; }[] {
                    return [];
                },
                run(operation, system) {
                    Object.assign(operation, { value: -1 });
                    system.push(operation);
                },
                check(state, system, sample) {
                    sample.assert.deepEqual(system, state);
                }
            }),
            propertyExecutionDefaults
        );
        scope.assert.equal(result.summary.failed, 1);
        const pristineOperationsValue: unknown = decodePropertyInput(
            modelWitness(result).counterexample,
            null,
            function () {
                return undefined;
            }
        );
        scope.assert(pristineModelOperations, pristineOperationsValue);

        return scope.assert.collect();
    }),
    test('checks terminal empty traces and supports scenario composition', async function (scope) {
        const scenario = modelScenario({
            ...counter(),
            commands() {
                return null;
            },
            length: { minLength: 0, maxLength: 5 }
        });
        const result = await executePropertyNode(
            property({ title: 'terminal', ...scenario }),
            propertyExecutionDefaults
        );
        scope.assert.equal(result.summary.passed, 1);
        return scope.assert.collect();
    })
]);
