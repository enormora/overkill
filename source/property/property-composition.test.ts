import { runIfMain } from '#test-runner';
import {
    createRoot,
    createTestPlan,
    createWorkloadTestCase,
    readTestBodyFamily,
    type TestBody,
    type TestNode,
    type TestPlan,
    type TestPlanCase,
    type TestScope
} from '../packages/engine/engine.entry-point.ts';
import { suite, table, test, createTestFacade } from '../packages/test/test.entry-point.ts';
import { defineResource, defineRuntime, withResource, withRuntime } from '../packages/test/resources.entry-point.ts';
import { createTestEngine } from '../test-support/create-test-engine.ts';
import { unexecutedGenerator } from '../test-support/property-generator.ts';
import { stampTestNodeFamily } from '../engine/test-node.ts';
import { resolveTestPlanCollectionPolicy } from '../run/run-test-plan.ts';
import { defaultPropertyPolicy } from '../config/property-policy.ts';
import { property, withProperties } from './property-authoring.ts';

function planFor(node: TestNode): TestPlan {
    return createTestPlan(createRoot({ annotations: {}, children: [ node ], controls: {}, title: 'composition root' }));
}

function unexpectedBody(): never {
    throw new Error('Nested body must not execute.');
}

async function assertUnavailableResourceProperty(scope: TestScope, body: TestBody): Promise<void> {
    const plan = planFor(test('resource property', body));
    scope.assert.equal(plan.cases[0].testFamily, 'property');
    scope.assert.deepEqual(plan.cases[0].resourceAttachments.directResources, [ {
        key: 'fixture',
        resourceName: 'fixture'
    } ]);
    const result = await createTestEngine().execute(plan);
    scope.require.defined(result.perTest);
    scope.assert.equal(result.summary.failed, 1);
    scope.assert.includes(JSON.stringify(result.perTest[0]?.outcome), 'Property execution is not available.');
}

function assertNestedPropertyDeclaration(scope: TestScope, planned: TestPlanCase, body: TestBody): void {
    scope.assert.equal(planned.testFamily, 'property');
    if (planned.execution.kind !== 'body') {
        throw new Error('Expected an executable property declaration.');
    }
    scope.assert.equal(readTestBodyFamily(planned.execution.body)?.definition, readTestBodyFamily(body)?.definition);
}

export const testNode = suite('property composition', [
    test('property profiles reject resource descriptors before acquisition', function (scope) {
        let acquisitions = 0;
        const resource = defineResource({
            name: 'fixture',
            scope: 'per-case',
            requirements: [],
            acquire() {
                acquisitions += 1;
                return { value: 1 };
            },
            dispose: null
        });
        const plan = planFor(test('resource property', withProperties(withResource(resource, unexpectedBody))));
        scope.assert.throws(function collectPropertyResource() {
            resolveTestPlanCollectionPolicy(plan, {
                testFamily: 'property',
                propertyPolicy: defaultPropertyPolicy,
                timeoutMilliseconds: 1000
            });
        }, { message: 'Run profile "property" cannot run test cases with resource descriptors.' });
        scope.assert.equal(acquisitions, 0);
        return scope.assert.collect();
    }),
    test('resource wrapper orders preserve declarations and prevent acquisition', async function (scope) {
        let acquisitions = 0;
        const resource = defineResource({
            name: 'fixture',
            scope: 'per-case',
            requirements: [],
            acquire() {
                acquisitions += 1;
                return { value: 1 };
            },
            dispose: null
        });
        const firstClass = property({
            title: 'resource declaration',
            generator: unexecutedGenerator<number>(),
            test: unexpectedBody
        });
        if (firstClass.execution.kind !== 'body' || firstClass.execution.bodyMode !== 'property') {
            throw new Error('Expected a property body.');
        }
        const bodies: readonly TestBody[] = [
            withResource(resource, withProperties(unexpectedBody)),
            withResource(resource, firstClass.execution.body),
            withProperties(withResource(resource, unexpectedBody))
        ];
        for (const body of bodies) {
            await assertUnavailableResourceProperty(scope, body);
        }
        scope.assert.equal(acquisitions, 0);
        return scope.assert.collect();
    }),
    test('runtime wrappers and facade mapping preserve nested declarations', function (scope) {
        const runtime = defineRuntime({ name: 'local', dimensions: {}, resources: {}, requirements: [] });
        const nested = withProperties(unexpectedBody);
        const facade = createTestFacade({
            runtime,
            mapScope() {
                return { value: 1 };
            }
        });
        for (
            const node of [
                test('runtime outside', withRuntime(runtime, nested)),
                test('property outside', withProperties(withRuntime(runtime, unexpectedBody))),
                facade.test('facade property', nested)
            ]
        ) {
            const planned = planFor(node).cases[0];
            scope.assert.equal(planned.testFamily, 'property');
            scope.assert.equal(planned.resourceAttachments.runtimeGraphs[0]?.name, 'local');
        }
        return scope.assert.collect();
    }),
    test('tables and workloads resolve property identity from each final body', function (scope) {
        const body = withProperties(unexpectedBody);
        const nodes = [
            table({ title: 'property rows', cases: [ 1, 2 ], test: body }),
            createWorkloadTestCase({
                annotations: {},
                controls: {},
                definitionLocations: [ { kind: 'unknown' } ],
                title: 'property workloads',
                workloads: [
                    { id: { name: 'one', params: {} }, body },
                    { id: { name: 'two', params: {} }, body }
                ]
            })
        ];
        for (const node of nodes) {
            const plan = planFor(node);
            scope.assert.equal(plan.cases.length, 2);
            for (const planned of plan.cases) {
                assertNestedPropertyDeclaration(scope, planned, body);
            }
        }
        return scope.assert.collect();
    }),
    test('table family stamps cannot conceal property bodies', function (scope) {
        const node = table({ title: 'conflict', cases: [ 1, 2 ], test: withProperties(unexpectedBody) });
        stampTestNodeFamily(node, 'microtest');
        scope.assert.throws(function () {
            return planFor(node);
        }, {
            message: 'Test body family "property" conflicts with test family "microtest".'
        });
        return scope.assert.collect();
    }),
    test('selection excludes unavailable property execution', async function (scope: TestScope) {
        const nested = test('excluded', withProperties(unexpectedBody));
        const ordinary = test('selected', function (inner) {
            inner.assert.equal(Object.hasOwn(inner, 'forall'), false);
            return inner.assert.collect();
        });
        const plan = planFor(suite('selected cases', [ nested, ordinary ]));
        const selected = plan.cases[1];
        scope.require.defined(selected);
        const result = await createTestEngine().execute({ ...plan, cases: [ selected ] });
        scope.assert.equal(result.summary.passed, 1);
        scope.assert.equal(result.summary.failed, 0);
        return scope.assert.collect();
    })
]);

await runIfMain(import.meta, testNode);
