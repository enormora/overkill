import { type TestNode, table, type TestScope, suite } from '@overkill-dev/test';

import type { RunResult } from '../packages/engine/engine.entry-point.ts';

import { gen, property } from '../packages/property/property.entry-point.ts';
import { linearizability } from '../packages/linearizability/linearizability.entry-point.ts';
import { executePropertyNode, propertyExecutionDefaults } from '../test-support/property-execution.ts';

function assertExhaustedConfirmation(scope: TestScope, result: RunResult, failures: number): void {
    const evidence = result.perTest[0]?.property?.invocations[0];
    scope.require.defined(evidence);
    scope.assert.equal(result.summary.failed, 1);
    scope.assert.equal(result.summary.inconclusive, 0);
    scope.assert.equal(evidence.shrinkStatus, 'interrupted');
    if (failures === 1) {
        scope.assert.equal(evidence.confirmedWitness, null);
    } else {
        scope.assert.notNull(evidence.confirmedWitness);
        scope.require.notNull(evidence.summary);
        scope.assert.greaterThan(evidence.summary.accounting.phases.shrinking.executed, 0);
    }
}
function assertScheduleDisagreement(scope: TestScope, result: RunResult): void {
    const evidence = result.perTest[0]?.property?.invocations[0];
    scope.require.defined(evidence);
    scope.assert.equal(result.summary.failed, 1);
    scope.assert.equal(result.summary.inconclusive, 0);
    scope.assert.equal(evidence.shrinkStatus, 'non-reproducible');
    scope.assert.equal(evidence.confirmedWitness, null);
    scope.assert.true(evidence.diagnostics.some(function disagreementObserved(diagnostic) {
        return diagnostic.reason === 'non-reproducible' && diagnostic.observation !== null;
    }));
}

export const testNode: TestNode = suite('linearizability confirmation', [
    table({
        title: 'preserves failure when confirmation exhausts checker work',
        cases: [ 1, 2 ],
        caseTitle(failures) {
            return `confirmation ${failures}`;
        },
        async test(scope) {
            const failures = scope.parameters;

            let calls = 0;
            const result = await executePropertyNode(
                property({
                    title: 'exhausted confirmation',
                    generator: gen.tuple(gen.tuple(gen.integer({ min: 1, max: 100 }))),
                    test: linearizability({
                        create() {
                            return null;
                        },
                        run() {
                            calls += 1;
                            return calls <= failures ? 1 : 0;
                        },
                        model: {
                            initial() {
                                return 0;
                            },
                            transition(state, observation) {
                                const matches = observation.outcome.kind === 'returned' &&
                                    observation.outcome.value === state;
                                return matches
                                    ? { kind: 'enabled', state }
                                    : { kind: 'disabled' };
                            }
                        },
                        maxWork: 2
                    })
                }),
                propertyExecutionDefaults
            );
            assertExhaustedConfirmation(scope, result, failures);
            return scope.assert.collect();
        }
    }),
    table({
        title: 'detects schedule disagreement during confirmation',
        cases: [ 1, 2 ],
        caseTitle(disagreement) {
            return `confirmation ${disagreement}`;
        },
        async test(scope) {
            const disagreement = scope.parameters;

            let created = 0;
            let cleaned = 0;
            const result = await executePropertyNode(
                property({
                    title: 'schedule changes',
                    generator: gen.tuple(gen.tuple(gen.constant(1)), gen.tuple(gen.constant(1))),
                    test: linearizability({
                        create(sample) {
                            created += 1;
                            sample.cleanup(function () {
                                cleaned += 1;
                            });
                            const gate = Promise.withResolvers<undefined>();
                            if (created > disagreement) {
                                gate.resolve(undefined);
                            }
                            return {
                                overlap: created <= disagreement,
                                counter: new Map([ [ 'value', 0 ] ]),
                                admitted: Array.of<number>(),
                                gate
                            };
                        },
                        async run(operation: number, system) {
                            const value = system.counter.get('value') ?? 0;
                            system.admitted.push(operation);
                            if (system.overlap) {
                                if (system.admitted.length === 2) {
                                    system.gate.resolve(undefined);
                                }
                                await system.gate.promise;
                            }
                            system.counter.set('value', value + operation);
                            return value + operation;
                        },
                        model: {
                            initial() {
                                return 0;
                            },
                            transition(state, observation) {
                                const next = state + observation.operation;
                                return observation.outcome.kind === 'returned' && observation.outcome.value === next
                                    ? { kind: 'enabled', state: next }
                                    : { kind: 'disabled' };
                            }
                        },
                        maxWork: 1000
                    })
                }),
                propertyExecutionDefaults
            );
            assertScheduleDisagreement(scope, result);
            scope.assert.equal(created, disagreement + 1);
            scope.assert.equal(cleaned, created);
            return scope.assert.collect();
        }
    })
]);
