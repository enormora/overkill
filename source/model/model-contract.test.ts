import type { Writable } from 'type-fest';
import { suite, test } from '../packages/test/test.entry-point.ts';
import { gen, property } from '../packages/property/property.entry-point.ts';
import { model, modelScenario, type ModelDefinition } from '../packages/model/model.entry-point.ts';
import { executePropertyNode, propertyExecutionDefaults } from '../test-support/property-execution.ts';

function counterDefinition(): ModelDefinition<number, number, number[]> {
    return {
        title: 'model contracts',
        settings: {},
        initial() {
            return 0;
        },
        commands() {
            return gen.constant<number>(1);
        },
        transition(state, operation) {
            return { kind: 'enabled', state: state + operation };
        },
        length: { minLength: 1, maxLength: 2 },
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
        }
    };
}

type TraceOperation = { readonly value: number; readonly trace: Writable<readonly TraceOperation[]>; };

function cyclicTrace(): readonly TraceOperation[] {
    const trace: TraceOperation[] = [];
    trace.push({ value: 1, trace });
    return trace;
}

export const testNode = suite('model contracts', [
    test('keeps validated commands stable when a payload mutates its trace', async function (scope) {
        const scenario = modelScenario<number, TraceOperation, number[]>({
            initial() {
                return 0;
            },
            commands() {
                return null;
            },
            transition(state, operation) {
                return { kind: 'enabled', state: state + operation.value };
            },
            length: { minLength: 0, maxLength: 1 },
            codec: null,
            examples: [],
            coverage: [],
            create(): number[] {
                return [];
            },
            run(operation, system) {
                system.push(operation.value);
                operation.trace.push({ value: 99, trace: operation.trace });
            },
            check(state, system, sample) {
                sample.assert.equal(
                    system.reduce(function (total, value) {
                        return total + value;
                    }, 0),
                    state
                );
            }
        });
        const node = property({ title: 'cyclic trace', ...scenario, generator: gen.constant(null).map(cyclicTrace) });
        const result = await executePropertyNode(node, propertyExecutionDefaults);
        scope.assert.equal(result.summary.passed, 1);
        scope.assert.equal(result.summary.failed, 0);
        return scope.assert.collect();
    }),
    test('rejects nondeterministic transition callbacks before creating a system', async function (scope) {
        let transitions = 0;
        let creations = 0;
        const node = model({
            ...counterDefinition(),
            transition(state, operation) {
                transitions += 1;
                return transitions % 2 === 1 ? { kind: 'enabled', state: state + operation } : { kind: 'disabled' };
            },
            create() {
                creations += 1;
                return [];
            }
        });
        const result = await executePropertyNode(node, propertyExecutionDefaults);
        scope.assert.equal(result.summary.failed, 1);
        scope.assert.equal(creations, 0);
        scope.assert.includes(JSON.stringify(result.perTest), 'Model transitions must be deterministic.');
        return scope.assert.collect();
    }),
    ...([ 'longer', 'shorter' ] as const).map(function (direction) {
        return test(`rejects ${direction} reconstruction before creating a system`, async function (scope) {
            let reconstructions = 0;
            let creations = 0;
            const node = model({
                ...counterDefinition(),
                examples: [ function () {
                    reconstructions += 1;
                    const firstLength = direction === 'longer' ? 1 : 2;
                    const length = reconstructions % 2 === 1 ? firstLength : 3 - firstLength;
                    return Array.from({ length }, function () {
                        return 1;
                    });
                } ],
                create() {
                    creations += 1;
                    return [];
                }
            });
            const result = await executePropertyNode(node, propertyExecutionDefaults);
            scope.assert.equal(result.summary.failed, 1);
            scope.assert.equal(creations, 0);
            scope.assert.includes(JSON.stringify(result.perTest), 'Model reconstruction changed the trace length.');
            return scope.assert.collect();
        });
    }),
    test('evaluates declared coverage through model checks', async function (scope) {
        const node = model({
            ...counterDefinition(),
            coverage: [ { label: 'positive', minimumPercent: 100 } ],
            check(state, system, sample) {
                sample.cover('positive', state > 0);
                sample.assert.equal(
                    system.reduce(function (total, value) {
                        return total + value;
                    }, 0),
                    state
                );
            }
        });
        const result = await executePropertyNode(node, propertyExecutionDefaults);
        scope.assert.equal(result.summary.passed, 1);
        return scope.assert.collect();
    })
]);
