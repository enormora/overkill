import {
    attachTestBodyResourceAttachments,
    createRoot,
    createSuite,
    createTestCase,
    createTestPlan,
    type TestBodyResourceAttachments,
    type TestPlan,
    type TestScope
} from '../packages/engine/engine.entry-point.ts';
import { collectedRunPlanFromTestPlan } from './collected-run-plan.ts';
import type { RunFilter } from './run-request-types.ts';
import {
    runtime,
    runtimeDimension,
    runtimeVariant
} from './run-selection-filters.ts';
import { selectedCollectedRunPlan, selectedTestPlan } from './run-selection.ts';
import { expandRuntimeMatrices } from './runtime-matrix-expansion.ts';

function runtimeMatrixAttachments(): TestBodyResourceAttachments {
    return {
        directResources: [],
        resourceGraph: [],
        runtimeGraphs: [ {
            kind: 'runtime-matrix',
            name: 'browser',
            resources: [],
            variants: [
                {
                    id: 'chromium',
                    runtime: {
                        dimensions: { engine: 'chromium' },
                        kind: 'runtime',
                        name: 'chromium-inner',
                        requirements: [],
                        resources: [],
                        scenarioBindings: []
                    }
                },
                {
                    id: 'firefox',
                    runtime: {
                        dimensions: { engine: 'firefox' },
                        kind: 'runtime',
                        name: 'firefox-inner',
                        requirements: [],
                        resources: [],
                        scenarioBindings: []
                    }
                }
            ]
        } ]
    };
}

function expandedRuntimePlan(): TestPlan {
    const testCase = createTestCase({
        annotations: {},
        body: attachTestBodyResourceAttachments(function attachedBody(scope: TestScope) {
            scope.assert.true(true);

            return scope.assert.collect();
        }, runtimeMatrixAttachments()),
        controls: {},
        definitionLocations: [ { kind: 'unknown' } ],
        title: 'uses browser'
    });

    return expandRuntimeMatrices(createTestPlan(createRoot({
        annotations: {},
        children: [ testCase ],
        controls: {},
        title: 'root'
    })));
}

function selectedRuntimeVariants(plan: TestPlan, filter: RunFilter): readonly (string | null | undefined)[] {
    const selection = { filter, kind: 'filter' as const };

    return selectedTestPlan(plan, selection).cases.map(function variantId(testCase) {
        return testCase.workId.runtimes[0]?.variantId;
    });
}

function selectedCollectedRuntimeVariants(
    plan: TestPlan,
    filter: RunFilter
): readonly (string | null | undefined)[] {
    const selection = { filter, kind: 'filter' as const };
    const collected = selectedCollectedRunPlan(collectedRunPlanFromTestPlan(plan), selection);

    return collected.files.flatMap(function fileVariants(collectedFile) {
        return collectedFile.cases.map(function variantId(testCase) {
            return testCase.workId?.runtimes[0]?.variantId;
        });
    });
}

function assertSelectedVariants(
    scope: TestScope,
    plan: TestPlan,
    filter: RunFilter,
    expectedVariants: readonly string[]
): void {
    scope.assert.deepEqual(selectedRuntimeVariants(plan, filter), expectedVariants);
    scope.assert.deepEqual(selectedCollectedRuntimeVariants(plan, filter), expectedVariants);
}

export const testNode = createSuite({
    annotations: {},
    children: [
        createTestCase({
            annotations: {},
            body(scope: TestScope) {
                const plan = expandedRuntimePlan();

                assertSelectedVariants(scope, plan, runtime('browser'), [ 'chromium', 'firefox' ]);
                assertSelectedVariants(scope, plan, runtimeVariant('browser', 'chromium'), [ 'chromium' ]);
                assertSelectedVariants(scope, plan, runtimeDimension('browser', 'engine', 'firefox'), [ 'firefox' ]);
                scope.assert.throws(function selectInnerRuntimeName() {
                    selectedTestPlan(plan, { filter: runtime('chromium-inner'), kind: 'filter' });
                }, { message: 'Run selection matched no test cases.' });

                return scope.assert.collect();
            },
            controls: {},
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'runtime filters select expanded plans by public identity'
        })
    ],
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/run/run-runtime-selection.test.ts'
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
