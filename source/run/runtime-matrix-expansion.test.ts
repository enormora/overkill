import { createSuite, createTestCase, type TestScope } from '../packages/engine/engine.entry-point.ts';
import { createCaseId, createDefaultWorkId } from '../engine/identity.ts';
import type { TestPlan, TestPlanCase } from '../engine/test-plan.ts';
import { expandRuntimeMatrices } from './runtime-matrix-expansion.ts';

const definitionLocation = { kind: 'unknown' as const };
const caseId = createCaseId('matrix.test.ts', [], 'runs on every variant', null);

function testCaseWithRuntimeGraphs(runtimeGraphs: TestPlanCase['resourceAttachments']['runtimeGraphs']): TestPlanCase {
    return {
        annotations: { ownership: [], tags: [] },
        controls: { capture: null, timeoutMilliseconds: null },
        definitionLocations: [ definitionLocation ],
        execution: { kind: 'skip', reason: 'planning only' },
        id: caseId,
        resourceAttachments: {
            directResources: [ { key: 'scratch', resourceName: 'scratch' } ],
            resourceGraph: [
                { dependencies: [ 'scratch-root' ], name: 'scratch', requirements: [], scope: 'per-case' },
                { dependencies: [], name: 'scratch-root', requirements: [], scope: 'per-case' },
                { dependencies: [], name: 'database-26', requirements: [], scope: 'per-case' },
                { dependencies: [], name: 'database-27', requirements: [], scope: 'per-case' },
                { dependencies: [], name: 'browser-chromium', requirements: [], scope: 'per-case' },
                { dependencies: [], name: 'browser-firefox', requirements: [], scope: 'per-case' },
                { dependencies: [ 'remote-sidecar' ], name: 'sidecar', requirements: [], scope: 'per-case' },
                { dependencies: [], name: 'unused', requirements: [], scope: 'per-case' }
            ],
            runtimeGraphs
        },
        suitePath: [],
        testFamily: 'integration',
        workId: createDefaultWorkId(caseId)
    };
}

function testPlan(testCase: TestPlanCase): TestPlan {
    return {
        cases: [ testCase ],
        defined: 1,
        discoveredCases: [ testCase ],
        orphans: [],
        root: {
            annotations: { ownership: [], tags: [] },
            controls: { capture: null, timeoutMilliseconds: null },
            title: 'matrix'
        }
    };
}

function matrixRuntimeGraph(name: string): TestPlanCase['resourceAttachments']['runtimeGraphs'][number] {
    return {
        kind: 'runtime-matrix',
        name,
        resources: [ { key: 'database', resourceName: 'database-26' } ],
        variants: [
            {
                id: 'node-26',
                runtime: {
                    dimensions: { node: '26' },
                    kind: 'runtime',
                    name: 'node-26',
                    requirements: [],
                    resources: [ { key: 'database', resourceName: 'database-26' } ]
                }
            },
            {
                id: 'node-27',
                runtime: {
                    dimensions: { node: '27' },
                    kind: 'runtime',
                    name: 'node-27',
                    requirements: [],
                    resources: [ { key: 'database', resourceName: 'database-27' } ]
                }
            }
        ]
    };
}

function browserRuntimeGraph(): TestPlanCase['resourceAttachments']['runtimeGraphs'][number] {
    return {
        kind: 'runtime-matrix',
        name: 'browser',
        resources: [ { key: 'page', resourceName: 'browser-chromium' } ],
        variants: [
            {
                id: 'chromium',
                runtime: {
                    dimensions: { engine: 'chromium' },
                    kind: 'runtime',
                    name: 'chromium',
                    requirements: [],
                    resources: [ { key: 'page', resourceName: 'browser-chromium' } ]
                }
            },
            {
                id: 'firefox',
                runtime: {
                    dimensions: { engine: 'firefox' },
                    kind: 'runtime',
                    name: 'firefox',
                    requirements: [],
                    resources: [ { key: 'page', resourceName: 'browser-firefox' } ]
                }
            }
        ]
    };
}

function sidecarRuntimeGraph(): TestPlanCase['resourceAttachments']['runtimeGraphs'][number] {
    return {
        dimensions: { service: 'sidecar' },
        kind: 'runtime',
        name: 'sidecar',
        requirements: [],
        resources: [ { key: 'server', resourceName: 'sidecar' } ]
    };
}

export const testNode = createSuite({
    definitionLocations: [ definitionLocation ],
    title: 'source/run/runtime-matrix-expansion.test.ts',
    annotations: {},
    controls: {},
    children: [
        createTestCase({
            definitionLocations: [ definitionLocation ],
            title: 'expands one matrix into work identities and selected resources',
            annotations: {},
            controls: {},
            body(scope: TestScope) {
                const expanded = expandRuntimeMatrices(
                    testPlan(testCaseWithRuntimeGraphs([ matrixRuntimeGraph('node'), sidecarRuntimeGraph() ]))
                );

                scope.assert.equal(expanded.cases.length, 2);
                scope.assert.deepEqual(
                    expanded.cases.map(function variantId(testCase) {
                        return testCase.workId.runtimes.map(function runtime(runtimeId) {
                            return runtimeId.variantId;
                        });
                    }),
                    [ [ 'node-26', null ], [ 'node-27', null ] ]
                );
                scope.assert.deepEqual(
                    expanded.cases.map(function resourceNames(testCase) {
                        return testCase.resourceAttachments.resourceGraph.map(function resourceName(resource) {
                            return resource.name;
                        });
                    }),
                    [
                        [ 'scratch', 'scratch-root', 'database-26', 'sidecar' ],
                        [ 'scratch', 'scratch-root', 'database-27', 'sidecar' ]
                    ]
                );
                scope.assert.deepEqual(
                    expanded.discoveredCases.map(function variantId(testCase) {
                        return testCase.workId.runtimes.map(function runtime(runtimeId) {
                            return runtimeId.variantId;
                        });
                    }),
                    [ [ 'node-26', null ], [ 'node-27', null ] ]
                );
                scope.assert.deepEqual(
                    expanded.cases.map(function runtimeResources(testCase) {
                        return testCase.resourceAttachments.runtimeGraphs.map(
                            function runtimeGraphResources(runtimeGraph) {
                                return runtimeGraph.resources.map(function runtimeResource(resource) {
                                    return resource.resourceName;
                                });
                            }
                        );
                    }),
                    [ [ [ 'database-26' ], [ 'sidecar' ] ], [ [ 'database-27' ], [ 'sidecar' ] ] ]
                );

                return scope.assert.collect();
            }
        }),
        createTestCase({
            definitionLocations: [ definitionLocation ],
            title: 'preserves cases without matrices',
            annotations: {},
            controls: {},
            body(scope: TestScope) {
                const testCase = testCaseWithRuntimeGraphs([]);
                const expanded = expandRuntimeMatrices(testPlan(testCase));

                scope.assert.equal(expanded.cases[0], testCase);
                scope.assert.equal(expanded.discoveredCases[0], testCase);

                return scope.assert.collect();
            }
        }),
        createTestCase({
            definitionLocations: [ definitionLocation ],
            title: 'expands multiple matrices as a cartesian product',
            annotations: {},
            controls: {},
            body(scope: TestScope) {
                const expanded = expandRuntimeMatrices(testPlan(testCaseWithRuntimeGraphs([
                    browserRuntimeGraph(),
                    matrixRuntimeGraph('node')
                ])));

                scope.assert.equal(expanded.cases.length, 4);
                scope.assert.deepEqual(
                    expanded.cases.map(function runtimeVariants(testCase) {
                        return testCase.workId.runtimes.map(function runtime(runtimeId) {
                            return [ runtimeId.name, runtimeId.variantId ];
                        });
                    }),
                    [
                        [ [ 'browser', 'chromium' ], [ 'node', 'node-26' ] ],
                        [ [ 'browser', 'chromium' ], [ 'node', 'node-27' ] ],
                        [ [ 'browser', 'firefox' ], [ 'node', 'node-26' ] ],
                        [ [ 'browser', 'firefox' ], [ 'node', 'node-27' ] ]
                    ]
                );
                scope.assert.deepEqual(
                    expanded.cases.map(function resourceNames(testCase) {
                        return testCase.resourceAttachments.resourceGraph.map(function resourceName(resource) {
                            return resource.name;
                        });
                    }),
                    [
                        [ 'scratch', 'scratch-root', 'database-26', 'browser-chromium' ],
                        [ 'scratch', 'scratch-root', 'database-27', 'browser-chromium' ],
                        [ 'scratch', 'scratch-root', 'database-26', 'browser-firefox' ],
                        [ 'scratch', 'scratch-root', 'database-27', 'browser-firefox' ]
                    ]
                );

                return scope.assert.collect();
            }
        }),
        createTestCase({
            definitionLocations: [ definitionLocation ],
            title: 'expands separate matrix wrappers as a cartesian product',
            annotations: {},
            controls: {},
            body(scope: TestScope) {
                const expanded = expandRuntimeMatrices(testPlan(testCaseWithRuntimeGraphs([
                    matrixRuntimeGraph('node'),
                    browserRuntimeGraph()
                ])));

                scope.assert.equal(expanded.cases.length, 4);

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
