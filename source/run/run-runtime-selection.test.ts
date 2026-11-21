import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { suite, test } from '@overkill-dev/test';

import {
    attachTestBodyResourceAttachments,
    type TestBodyResourceAttachments,
    type TestPlan,
    createRoot,
    createTestCase,
    createTestPlan
} from '../packages/engine/engine.entry-point.ts';

import { expandRuntimeMatrices } from '../engine/runtime-matrix-expansion.ts';
import { collectedRunPlanFromTestPlan } from './collected-run-plan.ts';
import type { RunFilter } from './run-request-types.ts';
import { runtime, runtimeDimension, runtimeVariant } from './run-selection-filters.ts';
import { selectedCollectedRunPlan, selectedTestPlan } from './run-selection.ts';

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
        body: attachTestBodyResourceAttachments(function attachedBody(scope) {
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

const assertSelectedVariants = defineCompositeAssertion({
    name: 'selected variants',
    assert(check, plan: TestPlan, filter: RunFilter, expectedVariants: readonly string[]) {
        return check.group([
            check.deepEqual(selectedRuntimeVariants(plan, filter), expectedVariants),
            check.deepEqual(selectedCollectedRuntimeVariants(plan, filter), expectedVariants)
        ]);
    }
});

export const testNode = suite('Run runtime selection', [
    test('runtime filters select expanded plans by public identity', function (scope) {
        const plan = expandedRuntimePlan();

        scope.assert(assertSelectedVariants, plan, runtime('browser'), [ 'chromium', 'firefox' ]);
        scope.assert(assertSelectedVariants, plan, runtimeVariant('browser', 'chromium'), [ 'chromium' ]);
        scope.assert(assertSelectedVariants, plan, runtimeDimension('browser', 'engine', 'firefox'), [ 'firefox' ]);
        scope.assert.throws(function selectInnerRuntimeName() {
            selectedTestPlan(plan, { filter: runtime('chromium-inner'), kind: 'filter' });
        }, { message: 'Run selection matched no test cases.' });

        return scope.assert.collect();
    })
]);
