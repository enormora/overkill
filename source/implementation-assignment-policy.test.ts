import { type TestScope, suite as authoredSuite, test } from '@overkill-dev/test';

import { implementationAdmission } from './test-support/implementation-admission.ts';
import {
    assignmentFacts,
    prepareImplementationAssignmentGraph,
    admitImplementationAssignments
} from './implementation-assignment.ts';
import { withImplementationActivations } from './implementation-participant.ts';

export const testNode = authoredSuite('implementation assignment admission', [
    test('collects stable assignment facts and rejects duplicate ownership', function (scope: TestScope) {
        const fixture = implementationAdmission();
        const facts = assignmentFacts(fixture.request);
        scope.assert.equal(facts.length, 1);
        scope.assert.equal(facts[0]?.key, 'case:body');
        scope.assert.throws(
            function () {
                return assignmentFacts({
                    ...fixture.request,
                    participants: [
                        ...fixture
                            .request
                            .participants,
                        ...fixture.request.participants
                    ]
                });
            },
            { message: 'Duplicate implementation ownership: case:body' }
        );
        return scope.assert.collect();
    }),
    test(
        'prepares and verifies the frozen graph before admitting implementation execution',
        async function (scope: TestScope) {
            const fixture = implementationAdmission();
            const prepared = await fixture.session.prepare(fixture.request);
            const value = await admitImplementationAssignments(
                { ...fixture.request, prepared },
                async function (activations) {
                    return withImplementationActivations(activations, async function () {
                        return 42;
                    });
                },
                async function () {
                    return fixture.graph;
                }
            );
            scope.assert.equal(value, 42);
            scope.assert.deepEqual(fixture.events, [ 'verify', 'deliver', 'bind', 'activate' ]);
            return scope.assert.collect();
        }
    ),
    test(
        'freezes single-run preparation results without changing assignment identity',
        async function (scope: TestScope) {
            const fixture = implementationAdmission();
            const original = await fixture.session.prepare(fixture.request);
            const { graph } = original;
            const prepared = await prepareImplementationAssignmentGraph(fixture.request, async function () {
                return graph;
            });
            scope.assert.true(Object.isFrozen(prepared));
            scope.assert.true(Object.isFrozen(prepared.assignments));
            scope.assert.deepEqual(prepared.assignments, assignmentFacts(fixture.request));
            return scope.assert.collect();
        }
    ),
    test('rejects changed bindings before loading a graph runtime', async function (scope: TestScope) {
        const fixture = implementationAdmission();
        const prepared = await fixture.session.prepare(fixture.request);
        const participants = fixture.request.participants.map(function (participant) {
            return {
                ...participant,
                binding: 'changed'
            };
        });
        await scope.assert.rejects(
            async function () {
                return admitImplementationAssignments(
                    { ...fixture.request, participants, prepared },
                    async function () {
                        return 42;
                    },
                    async function () {
                        return fixture.graph;
                    }
                );
            },
            { message: 'Implementation assignments changed; prepare and collect a new run.' }
        );
        scope.assert.deepEqual(fixture.events, []);
        return scope.assert.collect();
    }),
    test('admits a selected subset against the complete prepared assignment graph', async function (scope: TestScope) {
        const fixture = implementationAdmission();
        const prepared = await fixture.session.prepare(fixture.request);
        scope.assert.equal(
            await admitImplementationAssignments(
                { ...fixture.request, participants: [], prepared },
                async function (activations) {
                    return activations
                        .length;
                },
                async function () {
                    return fixture.graph;
                }
            ),
            0
        );
        scope.assert.deepEqual(fixture.events, [ 'verify', 'deliver' ]);
        return scope.assert.collect();
    }),
    test('rejects admission and preparation after cancellation', async function (scope: TestScope) {
        const fixture = implementationAdmission();
        const prepared = await fixture.session.prepare(fixture.request);
        const failure = new Error('Cancelled implementation.');
        fixture.controller.abort(failure);
        await scope.assert.rejects(async function () {
            return fixture.session.prepare(fixture.request);
        }, { exact: failure });
        await scope.assert.rejects(
            async function () {
                return admitImplementationAssignments(
                    { ...fixture.request, prepared },
                    async function () {
                        return 42;
                    },
                    async function () {
                        return fixture.graph;
                    }
                );
            },
            { exact: failure }
        );
        scope.assert.deepEqual(fixture.events, []);
        return scope.assert.collect();
    }),
    test('observes cancellation that arrives while preparing the graph', async function (scope: TestScope) {
        const fixture = implementationAdmission();
        const original = await fixture.session.prepare(fixture.request);
        const { graph } = original;
        const failure = new Error('Cancelled during preparation.');
        await scope.assert.rejects(async function () {
            return prepareImplementationAssignmentGraph(fixture.request, async function () {
                fixture.controller.abort(failure);
                return graph;
            });
        }, { exact: failure });
        return scope.assert.collect();
    })
]);
