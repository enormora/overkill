import { type TestNode, type TestScope, suite, test } from '@overkill-dev/test';
import { type EngineCaseBody, createTestEngine } from '../test-support/create-test-engine.ts';

function passingBody(
    scope: { readonly assert: Pick<TestScope['assert'], 'true' | 'collect'>; }
): ReturnType<EngineCaseBody> {
    scope.assert.true(true);

    return scope.assert.collect();
}

export const testNode: TestNode = suite('Test plan authoring rules', [
    test('rejects reachable tables with fewer than two cases', function (scope) {
        const engine = createTestEngine();
        const emptyTableRoot = engine.createRoot({
            children: [
                engine.createTable({
                    definitionLocations: [ { kind: 'unknown' as const } ],
                    cases: [],
                    annotations: {},
                    controls: {},
                    title: 'empty rows'
                })
            ],
            annotations: {},
            controls: {},
            title: 'root'
        });
        const singleRowTableRoot = engine.createRoot({
            children: [
                engine.createTable({
                    definitionLocations: [ { kind: 'unknown' as const } ],
                    cases: [
                        {
                            body: passingBody,
                            annotations: {},
                            controls: {},
                            parameters: 'only',
                            title: 'only row'
                        }
                    ],
                    annotations: {},
                    controls: {},
                    title: 'single row'
                })
            ],
            annotations: {},
            controls: {},
            title: 'root'
        });

        scope.assert.throws(function createPlanWithEmptyTable() {
            engine.createTestPlan(emptyTableRoot);
        }, { message: 'Table must contain at least two cases: empty rows.' });
        scope.assert.throws(function createPlanWithSingleRowTable() {
            engine.createTestPlan(singleRowTableRoot);
        }, { message: 'Table must contain at least two cases: single row.' });

        return scope.assert.collect();
    }),
    test('rejects duplicate sibling titles', function (scope) {
        const engine = createTestEngine();
        const root = engine.createRoot({
            children: [
                engine.createTestCase({
                    definitionLocations: [ { kind: 'unknown' as const } ],
                    body: passingBody,
                    annotations: {},
                    controls: {},
                    title: 'same'
                }),
                engine.createTestCase({
                    definitionLocations: [ { kind: 'unknown' as const } ],
                    body: passingBody,
                    annotations: {},
                    controls: {},
                    title: 'same'
                })
            ],
            annotations: {},
            controls: {},
            title: 'root'
        });

        scope.assert.throws(function createPlanWithDuplicateTitles() {
            engine.createTestPlan(root);
        }, { message: 'Duplicate test node title under root: same.' });

        return scope.assert.collect();
    }),
    test('rejects reachable empty nested suites', function (scope) {
        const engine = createTestEngine();
        const root = engine.createRoot({
            children: [
                engine.createSuite({
                    definitionLocations: [ { kind: 'unknown' as const } ],
                    children: [
                        engine.createSuite({
                            definitionLocations: [ { kind: 'unknown' as const } ],
                            children: [],
                            annotations: {},
                            controls: {},
                            title: 'empty'
                        })
                    ],
                    annotations: {},
                    controls: {},
                    title: 'parent'
                })
            ],
            annotations: {},
            controls: {},
            title: 'root'
        });

        scope.assert.throws(function createPlanWithEmptySuite() {
            engine.createTestPlan(root);
        }, { message: 'Suite must contain at least one child: parent > empty.' });

        return scope.assert.collect();
    }),
    test('rejects duplicate table case titles', function (scope) {
        const engine = createTestEngine();
        const root = engine.createRoot({
            children: [
                engine.createTable({
                    definitionLocations: [ { kind: 'unknown' as const } ],
                    cases: [
                        {
                            body: passingBody,
                            annotations: {},
                            controls: {},
                            parameters: { value: 1 },
                            title: 'same'
                        },
                        {
                            body: passingBody,
                            annotations: {},
                            controls: {},
                            parameters: { value: 2 },
                            title: 'same'
                        }
                    ],
                    annotations: {},
                    controls: {},
                    title: 'rows'
                })
            ],
            annotations: {},
            controls: {},
            title: 'root'
        });

        scope.assert.throws(function createPlanWithDuplicateTableCaseTitles() {
            engine.createTestPlan(root);
        }, { message: 'Duplicate test node title under rows: same.' });

        return scope.assert.collect();
    })
]);
