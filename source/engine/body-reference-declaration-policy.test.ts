import { type TestScope, suite as authoredSuite, test } from '@overkill-dev/test';

import { testDouble } from '../packages/test/test.entry-point.ts';
import { bodyReferencePlan } from '../test-support/body-reference-plan.ts';
import { memoryImplementationGraph, memoryImplementationModule } from '../test-support/memory-implementation-graph.ts';
import {
    createPreparedAssignmentSession,
    type PreparedImplementationAssignments
} from '../implementation-assignment.ts';
import {
    declareImplementationPlan,
    implementationDeclarations,
    implementationPlan,
    prepareBodyReferences
} from './body-reference-plan.ts';

const context = { projectRoot: '/project' };
const bodyModule = memoryImplementationModule('file:///project/body.mjs', {});
export const testNode = authoredSuite('body implementation declarations', [
    test('declares referenced bodies from a cached graph preparation session', async function (scope: TestScope) {
        const plan = bodyReferencePlan(true);
        const sources = memoryImplementationGraph([ bodyModule ]);
        const preparation = createPreparedAssignmentSession(sources.preparation);
        const declared = await declareImplementationPlan(plan, context, scope.signal, async function () {
            return preparation;
        });
        scope.assert.notEqual(declared, plan);
        scope.assert.deepEqual(
            Array.from(implementationDeclarations(declared).values(), function (value) {
                return value.kind;
            }),
            [
                'prepared'
            ]
        );
        scope.assert.equal(
            await declareImplementationPlan(declared, context, scope.signal, async function () {
                throw new Error('Already declared.');
            }),
            declared
        );
        return scope.assert.collect();
    }),
    test('prepares a frozen catalog from declared assignment provenance', async function (scope: TestScope) {
        const sources = memoryImplementationGraph([ bodyModule ]);
        const preparation = createPreparedAssignmentSession(sources.preparation);
        const declared = await declareImplementationPlan(
            bodyReferencePlan(true),
            context,
            scope.signal,
            async function () {
                return preparation;
            }
        );
        const prepared = await prepareBodyReferences(declared, context, scope.signal);
        const state = implementationPlan(prepared);
        scope.assert.equal(state?.admission, 'all');
        scope.assert.equal(state?.catalog?.builds.length, 1);
        scope.assert.equal(await prepareBodyReferences(prepared, context, scope.signal), prepared);
        return scope.assert.collect();
    }),
    test('retains source preparation failures as invalid declarations', async function (scope: TestScope) {
        const sources = memoryImplementationGraph([]);
        const preparation = createPreparedAssignmentSession(sources.preparation);
        const declared = await declareImplementationPlan(
            bodyReferencePlan(true),
            context,
            scope.signal,
            async function () {
                return preparation;
            }
        );
        const values = Array.from(implementationDeclarations(declared).values());
        scope.assert.equal(values[0]?.kind, 'invalid');
        await scope.assert.rejects(async function () {
            return prepareBodyReferences(declared, context, scope.signal);
        }, {
            message: 'Unknown implementation module: file:///project/body.mjs'
        });
        return scope.assert.collect();
    }),
    test(
        'retains nonerror preparation failures as portable declaration diagnostics',
        async function (scope: TestScope) {
            const declared = await declareImplementationPlan(
                bodyReferencePlan(true),
                context,
                scope.signal,
                async function () {
                    return {
                        async prepare() {
                            return testDouble.throws<() => PreparedImplementationAssignments>('Rejected by loader.')();
                        }
                    };
                }
            );
            const values = Array.from(implementationDeclarations(declared).values());
            const [ value ] = values;
            if (value?.kind !== 'invalid') {
                throw new Error('Expected invalid declaration.');
            }
            scope.assert.deepEqual({ name: value.failure.name, message: value.failure.message }, {
                name: 'Error',
                message: 'Rejected by loader.'
            });
            return scope.assert.collect();
        }
    ),
    test('does not initialize graph preparation for ordinary body plans', async function (scope: TestScope) {
        const plan = bodyReferencePlan(false);
        scope.assert.equal(
            await declareImplementationPlan(plan, context, scope.signal, async function () {
                throw new Error('Unnecessary implementation preparation.');
            }),
            plan
        );
        return scope.assert.collect();
    }),
    test('propagates cancellation instead of publishing an invalid declaration', async function (scope: TestScope) {
        const sources = memoryImplementationGraph([ bodyModule ]);
        const preparation = createPreparedAssignmentSession(sources.preparation);
        const controller = new AbortController();
        const failure = new Error('Cancelled declarations.');
        controller.abort(failure);
        await scope.assert.rejects(
            async function () {
                return declareImplementationPlan(
                    bodyReferencePlan(true),
                    context,
                    controller.signal,
                    async function () {
                        return preparation;
                    }
                );
            },
            { exact: failure }
        );
        scope.assert.deepEqual(sources.calls, []);
        return scope.assert.collect();
    })
]);
