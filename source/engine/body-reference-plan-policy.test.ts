import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { bodyReferencePlan } from '../test-support/body-reference-plan.ts';
import { memoryImplementationCatalog } from '../test-support/memory-implementation-catalog.ts';
import { testNode as declarations } from './body-reference-declaration-policy.test.ts';
import { testNode as admission } from './body-plan-admission.test.ts';
import {
    setImplementationPlan,
    withImplementationPlan,
    implementationPlan,
    implementationDeclarations,
    hasBodyImplementations,
    declareImplementations,
    prepareBodyReferences,
    catalogFromDeclarations,
    withBodyPlanAdmission,
    withPreparedBodyPlan
} from './body-reference-plan.ts';

const context = { projectRoot: '/project' };
const state = { admission: 'all', catalog: null } as const;
export const testNode = suite('frozen body reference planning policy', [
    declarations,
    admission,
    test('retains plan state without changing object identity', function (scope: TestScope) {
        const plan = { name: 'plan' };
        scope.assert.equal(setImplementationPlan(plan, state), plan);
        scope.assert.equal(implementationPlan(plan), state);
        scope.assert.deepEqual(Object.keys(plan), [ 'name' ]);
        return scope.assert.collect();
    }),
    test('attaches portable plan state without changing the source object', function (scope: TestScope) {
        const plan = { name: 'plan' };
        const frozen = withImplementationPlan(plan, state);
        scope.assert.notEqual(frozen, plan);
        scope.assert.equal(implementationPlan(frozen), state);
        scope.assert.equal(implementationPlan(plan), null);
        return scope.assert.collect();
    }),
    test('does not read plan state from unrelated values', function (scope: TestScope) {
        for (const value of [ null, undefined, 'plan', 42, {}, [] ]) {
            scope.assert.equal(implementationPlan(value), null);
        }
        return scope.assert.collect();
    }),
    test('leaves ordinary body plans unchanged during declaration and preparation', async function (scope: TestScope) {
        const plan = bodyReferencePlan(false);
        scope.assert.false(hasBodyImplementations(plan));
        scope.assert.equal(await declareImplementations(plan, context, scope.signal), plan);
        scope.assert.equal(await prepareBodyReferences(plan, context, scope.signal), plan);
        scope.assert.equal(implementationDeclarations(plan).size, 0);
        return scope.assert.collect();
    }),
    test('runs ordinary plans without implementation admission', async function (scope: TestScope) {
        const plan = bodyReferencePlan(false);
        const value = await withBodyPlanAdmission(plan, null, async function (resolved, activations) {
            scope.assert.equal(resolved, plan);
            scope.assert.deepEqual(activations, []);
            return 42;
        });
        scope.assert.equal(value, 42);
        scope.assert.equal(
            await withPreparedBodyPlan(plan, scope.signal, async function (resolved) {
                return resolved;
            }),
            plan
        );
        return scope.assert.collect();
    }),
    test('requires explicit family preparation before executing referenced bodies', async function (scope: TestScope) {
        const plan = bodyReferencePlan(true);
        scope.assert.true(hasBodyImplementations(plan));
        await scope.assert.rejects(async function () {
            await withBodyPlanAdmission(plan, scope.signal, async function () {
                return 42;
            });
        }, { message: 'Referenced implementations require explicit family preparation and collection.' });
        return scope.assert.collect();
    }),
    test('rejects referenced bodies whose frozen state has no provenance', async function (scope: TestScope) {
        const plan = withImplementationPlan(bodyReferencePlan(true), state);
        await scope.assert.rejects(async function () {
            await withBodyPlanAdmission(plan, scope.signal, async function () {
                return 42;
            });
        }, { message: 'Frozen execution has no implementation provenance; prepare a new run.' });
        await scope.assert.rejects(async function () {
            await prepareBodyReferences(plan, context, scope.signal);
        }, { message: 'Frozen execution has no implementation provenance; prepare a new run.' });
        return scope.assert.collect();
    }),
    test('rejects a frozen catalog prepared for another project root', async function (scope: TestScope) {
        const catalog = memoryImplementationCatalog();
        const plan = withImplementationPlan(bodyReferencePlan(true), { admission: 'all', catalog });
        await scope.assert.rejects(async function () {
            await prepareBodyReferences(plan, { projectRoot: '/other' }, scope.signal);
        }, { message: 'Implementation project root changed.' });
        return scope.assert.collect();
    }),
    test('returns no catalog when no declarations have prepared builds', function (scope: TestScope) {
        scope.assert.equal(catalogFromDeclarations([ null ], '/project'), null);
        scope.assert.equal(catalogFromDeclarations([], '/project'), null);
        return scope.assert.collect();
    }),
    test('preserves invalid declaration messages when constructing a catalog', function (scope: TestScope) {
        scope.assert.throws(function () {
            catalogFromDeclarations([ {
                kind: 'invalid',
                failure: { name: 'Error', message: 'Input rejected.', detail: { value: 42 } }
            } ], '/project');
        }, { type: TypeError, message: 'Input rejected.' });
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);
