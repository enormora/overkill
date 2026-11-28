import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { table, suite, test, type TestScope } from '@overkill-dev/test';

import type { Writable } from 'type-fest';
import { generatorContext, shrinkDescendants, retainedGeneratorInput } from '../test-support/generator-execution.ts';

import type { PropertyInvocationEvidence } from '../packages/engine/engine.entry-point.ts';

import {
    gen,
    property,
    type PropertySampleScope,
    type Generator as PropertyGenerator
} from '../packages/property/property.entry-point.ts';
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

const assertEnabledTrace = defineCompositeAssertion({
    name: 'enabled trace',
    assert(check, trace: readonly number[]) {
        const initialChecks = check.between(trace.length, 1, 4);
        let state = 0;
        return check.group([
            initialChecks,
            ...trace.map(function (operation) {
                state += operation;
                return check.between(state, 0, 3);
            })
        ]);
    }
});

type ShrinkTraceCoverage = {
    readonly values: readonly (readonly number[])[];
    readonly examined: number;
    readonly shortened: boolean;
    readonly changed: boolean;
};

function inspectShrinkTraces(
    generator: PropertyGenerator<readonly number[]>,
    seed: number
): ShrinkTraceCoverage {
    const root = retainedGeneratorInput(generator, seed, generatorContext(4, 4, 100_000));
    const original = root.reconstruct();
    const descendants = shrinkDescendants(root, 30, function (candidate) {
        return candidate.shrink();
    });
    const traces = [ root, ...descendants ].map(function (candidate) {
        return candidate.reconstruct();
    });
    return {
        values: traces,
        examined: descendants.length,
        shortened: traces.some(function (trace) {
            return trace.length < original.length;
        }),
        changed: traces.some(function (trace) {
            return trace.some(function (operation, index) {
                return operation !== original[index];
            });
        })
    };
}

const assertConfirmedShrink = defineCompositeAssertion({
    name: 'confirmed shrink',
    assert(check, evidence: PropertyInvocationEvidence) {
        if (evidence.confirmedWitness === null) {
            return check.defined(evidence.confirmedWitness);
        }
        return check.group([
            check.equal((evidence.summary?.accounting.phases.shrinking.executed ?? 0) > 0, true),
            check.equal((evidence.summary?.accounting.phases.confirmation.executed ?? 0) >= 2, true),
            check.equal(evidence.shrinkStatus, 'search-exhausted'),
            check.deepEqual(evidence.diagnostics, [])
        ]);
    }
});

export const testNode = suite('model contracts', [
    test('rejects a late disabled operation before system callbacks', async function (scope) {
        const events: string[] = [];
        const result = await executePropertyNode(
            model({
                ...counterDefinition(),
                examples: [ function () {
                    return [ 1, 2, -1 ];
                } ],
                transition(state, operation) {
                    return operation < 0 ? { kind: 'disabled' } : { kind: 'enabled', state: state + operation };
                },
                create() {
                    events.push('create');
                    return [];
                },
                run() {
                    events.push('run');
                },
                check() {
                    events.push('check');
                }
            }),
            propertyExecutionDefaults
        );
        scope.assert.equal(result.summary.failed, 1);
        scope.assert.deepEqual(events, []);
        scope.assert.includes(JSON.stringify(result.perTest), 'Model trace contains a disabled operation at index 2.');
        return scope.assert.collect();
    }),
    test('preserves enabled transitions through state-dependent shrinking', function (scope) {
        const scenario = modelScenario({
            ...counterDefinition(),
            length: { minLength: 1, maxLength: 8 },
            commands(state) {
                return gen.integer({ min: -state, max: 3 - state });
            },
            transition(state, operation) {
                const next = state + operation;
                return next < 0 || next > 3 ? { kind: 'disabled' } : { kind: 'enabled', state: next };
            }
        });
        const traces = Array.from({ length: 10 }, function (_value, seed) {
            return inspectShrinkTraces(scenario.generator, seed);
        });
        for (const coverage of traces) {
            for (const trace of coverage.values) {
                scope.assert(assertEnabledTrace, trace);
            }
        }
        scope.assert.equal(
            traces.some(function (trace) {
                return trace.examined > 0;
            }),
            true
        );
        scope.assert.equal(
            traces.some(function (trace) {
                return trace.shortened;
            }),
            true
        );
        scope.assert.equal(
            traces.some(function (trace) {
                return trace.changed;
            }),
            true
        );
        return scope.assert.collect();
    }),
    table({
        title: 'orders model callbacks and cleanup after execution',
        cases: [ 'success', 'require', 'throw' ] as const,
        caseTitle(mode) {
            return mode;
        },
        async test(scope) {
            const mode = scope.parameters;

            const events: string[] = [];
            const result = await executePropertyNode(
                model({
                    ...counterDefinition(),
                    examples: [ function () {
                        return [ 1, 2 ];
                    } ],
                    settings: { newTrials: 1, maxShrinkWork: 0 },
                    create(sample): number[] {
                        events.push('create');
                        sample.cleanup(function () {
                            events.push('cleanup');
                        });
                        return [];
                    },
                    run(operation, system) {
                        events.push(`run:${operation}`);
                        if (mode === 'throw') {
                            throw new Error('operation failed');
                        }
                        system.push(operation);
                    },
                    check(state: number, system: readonly number[], sample: PropertySampleScope<readonly number[]>) {
                        events.push(`check:${state}`);
                        sample.require.defined(mode === 'require' && state === 1 ? undefined : state);
                        sample.assert.equal(
                            system.reduce(function (total, value) {
                                return total + value;
                            }, 0),
                            state
                        );
                    }
                }),
                propertyExecutionDefaults
            );
            const expected = {
                throw: [ 'create', 'check:0', 'run:1', 'cleanup' ],
                require: [ 'create', 'check:0', 'run:1', 'check:1', 'cleanup' ],
                success: [ 'create', 'check:0', 'run:1', 'check:1', 'run:2', 'check:3', 'cleanup' ]
            }[mode];
            scope.assert.deepEqual(events.slice(0, expected.length), expected);
            scope.assert.equal(events.at(-1), 'cleanup');
            scope.assert.equal(result.summary.failed, mode === 'success' ? 0 : 1);
            if (mode === 'throw') {
                scope.assert.includes(JSON.stringify(result.perTest), 'operation failed');
            }
            return scope.assert.collect();
        }
    }),

    test('confirms and shrinks the original model mismatch', async function (scope: TestScope) {
        const result = await executePropertyNode(
            model({
                ...counterDefinition(),
                commands() {
                    return gen.integer({ min: 1, max: 20 });
                },
                length: { minLength: 1, maxLength: 5 },
                run(operation, system) {
                    system.push(-operation);
                }
            }),
            propertyExecutionDefaults
        );
        const evidence = result.perTest[0]?.property?.invocations[0];
        scope.require.defined(evidence);
        scope.assert(assertConfirmedShrink, evidence);
        scope.require.defined(evidence.confirmedWitness);
        const replay = await executePropertyNode(
            model({
                ...counterDefinition(),
                commands() {
                    throw new Error('unexpected generation');
                },
                run(operation, system) {
                    system.push(-operation);
                }
            }),
            { ...propertyExecutionDefaults, replay: evidence.confirmedWitness }
        );
        scope.assert.equal(replay.summary.failed, 1);
        scope.assert.equal(JSON.stringify(replay).includes('unexpected generation'), false);
        return scope.assert.collect();
    }),
    test('preserves aliases and separates prediction from system graphs', async function (scope) {
        const scenario = modelScenario<readonly TraceOperation[], TraceOperation, TraceOperation[]>({
            initial() {
                return [];
            },
            commands() {
                return null;
            },
            transition(state, operation) {
                return { kind: 'enabled', state: [ ...state, operation ] };
            },
            length: { minLength: 0, maxLength: 0 },
            codec: null,
            examples: [ function () {
                const trace = cyclicTrace();
                return [ ...trace, ...trace ];
            } ],
            coverage: [],
            create() {
                return [];
            },
            run(operation, system) {
                if (operation.trace[0] !== operation) {
                    throw new Error('The model operation lost its trace alias.');
                }
                Object.assign(operation, { value: 99 });
                system.push(operation);
            },
            check(state, system, sample) {
                if (state.length > 0) {
                    sample.assert.equal(state[0]?.value, 1);
                    sample.assert.equal(system[0]?.value, 99);
                    sample.assert.equal(state[0] === system[0], false);
                    sample.assert.equal(state[0]?.trace[0], state[0]);
                }
                if (state.length === 2) {
                    sample.assert.equal(state[0], state[1]);
                    sample.assert.equal(system[0], system[1]);
                }
                sample.assert.equal(state.length, system.length);
            }
        });
        const result = await executePropertyNode(property({ title: 'graph model', ...scenario }), {
            ...propertyExecutionDefaults,
            policy: { ...propertyExecutionDefaults.policy, newTrials: 1 }
        });
        scope.assert.equal(result.summary.passed, 1);
        return scope.assert.collect();
    }),
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
    test(
        'rejects nondeterministic transition callbacks before creating a system',
        async function (scope) {
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
        }
    ),
    table({
        title: 'rejects invalid reconstruction before creating a system',
        cases: [ 'longer', 'shorter' ] as const,
        caseTitle(direction) {
            return direction;
        },
        async test(scope) {
            const direction = scope.parameters;

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
        }
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
