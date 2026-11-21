import { table, type TestScope, suite, test } from '@overkill-dev/test';
import { type EngineCaseBody, executeEngineCase, engineCasePassed } from '../../../test-support/create-test-engine.ts';

import { bodyPlanAdmission } from '../../../test-support/body-plan-admission.ts';
import { withImplementationActivations } from '../../../implementation-participant.ts';
import { admitBodyPlan, withImplementationPlan, implementationPlan } from '../../../engine/body-reference-plan.ts';
import { isBodyReference } from '../../../engine/test-body.ts';

export const testNode = suite('body plan implementation admission', [
    test(
        'binds admitted implementations before handing the plan to execution',
        async function (scope) {
            const fixture = await bodyPlanAdmission();
            const value = await admitBodyPlan(fixture.plan, scope.signal, async function (resolved, activations) {
                const { execution } = resolved.cases[0];
                if (execution.kind !== 'body' || execution.bodyMode !== 'builder' || isBodyReference(execution.body)) {
                    throw new Error('Expected admitted ordinary body.');
                }
                const { body } = execution;
                let captured: Awaited<ReturnType<EngineCaseBody>> | null = null;
                const result = await executeEngineCase(async function (subjectScope) {
                    captured = await withImplementationActivations(activations, async function () {
                        return body(subjectScope);
                    });
                    return captured;
                });
                scope.assert(engineCasePassed, result);
                return captured;
            }, fixture.runtime);
            scope.assert.partialDeepEqual<unknown, unknown>(value, [ {
                check: 'equal',
                actual: null,
                expected: null
            } ]);
            scope.assert.deepEqual(fixture.events, [ 'restore', 'verify' ]);
            return scope.assert.collect();
        }
    ),
    table({
        title: 'admits body implementations across execution phases',
        cases: [ 'all', 'consumer' ] as const,
        caseTitle(admission) {
            return admission;
        },
        async test(scope) {
            const require: typeof scope.require = scope.require;

            const admission = scope.parameters;

            const fixture = await bodyPlanAdmission();
            const state = implementationPlan(fixture.plan);
            require.defined(state);
            const plan = withImplementationPlan(fixture.plan, { ...state, admission });
            scope.assert.equal(
                await admitBodyPlan(plan, null, async function (_resolved, activations) {
                    return activations.length;
                }, fixture.runtime),
                1
            );
            return scope.assert.collect();
        }
    }),
    test(
        'preserves bodies outside admission when an explicit owner-only phase excludes them',
        async function (scope: TestScope) {
            const fixture = await bodyPlanAdmission();
            const state = implementationPlan(fixture.plan);
            scope.require.defined(state);
            const plan = withImplementationPlan(fixture.plan, { ...state, admission: { body: false, ownerKeys: [] } });
            await admitBodyPlan(plan, scope.signal, async function (resolved, activations) {
                scope.assert.equal(resolved.cases[0].execution, fixture.plan.cases[0].execution);
                scope.assert.equal(activations.length, 0);
            }, fixture.runtime);
            scope.assert.deepEqual(fixture.events, [ 'restore', 'verify' ]);
            return scope.assert.collect();
        }
    ),
    test(
        'includes body implementations when explicit admission enables them',
        async function (scope: TestScope) {
            const fixture = await bodyPlanAdmission();
            const state = implementationPlan(fixture.plan);
            scope.require.defined(state);
            const plan = withImplementationPlan(fixture.plan, { ...state, admission: { body: true, ownerKeys: [] } });
            scope.assert.equal(
                await admitBodyPlan(
                    plan,
                    scope.signal,
                    async function (_resolved, activations) {
                        return activations.length;
                    },
                    fixture.runtime
                ),
                1
            );
            return scope.assert.collect();
        }
    ),
    test('rejects changed implementation builds before binding bodies', async function (scope: TestScope) {
        const fixture = await bodyPlanAdmission();
        const catalog = implementationPlan(fixture.plan)?.catalog;
        scope.require.defined(catalog);
        const [ build ] = catalog.builds;
        scope.require.defined(build);
        const plan = withImplementationPlan(fixture.plan, {
            admission: 'all',
            catalog: { ...catalog, builds: [ { ...build, graph: { ...build.graph, build: 'forged' } } ] }
        });
        await scope.assert.rejects(async function () {
            return admitBodyPlan(plan, scope.signal, async function () {
                return 42;
            }, fixture.runtime);
        }, {
            message: 'Implementation build changed; prepare and collect a new run.'
        });
        return scope.assert.collect();
    }),
    test(
        'rejects catalogs that combine multiple original builds before restoring modules',
        async function (scope: TestScope) {
            const fixture = await bodyPlanAdmission();
            const state = implementationPlan(fixture.plan);
            const build = state?.catalog?.builds[0];
            scope.require.defined(build);
            const plan = withImplementationPlan(fixture.plan, {
                admission: 'all',
                catalog: { projectRoot: '/project', builds: [ build, { ...build, assignments: [] } ] }
            });
            await scope.assert.rejects(async function () {
                return admitBodyPlan(plan, scope.signal, async function () {
                    return 42;
                }, fixture.runtime);
            }, {
                message: 'Execution requires one original implementation build.'
            });
            scope.assert.deepEqual(fixture.events, []);
            return scope.assert.collect();
        }
    )
]);
