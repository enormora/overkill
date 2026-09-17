import {
    attachTestBodyResourceAttachments,
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestBodyResourceAttachments
} from '../packages/engine/engine.entry-point.ts';
import { createTestEngine as createEngine } from '../test-support/create-test-engine.ts';
import { collectedRunPlanFromTestPlan } from './collected-run-plan.ts';
import type { CollectedRunCase } from './run-types.ts';

const attachments: TestBodyResourceAttachments = {
    directResources: [],
    resourceGraph: [
        {
            dependencies: [],
            name: 'database',
            requirements: [ { kind: 'exclusive-resource', name: 'database' } ],
            scope: 'per-case'
        }
    ],
    runtimeGraphs: [
        {
            dimensions: {},
            kind: 'runtime',
            name: 'api',
            requirements: [],
            resources: [ { key: 'database', resourceName: 'database' } ]
        }
    ]
};

function collectedCasesWithAttachments(): readonly [CollectedRunCase, CollectedRunCase] {
    const engine = createEngine();
    const root = engine.createRoot({
        annotations: {},
        children: [
            engine.createTestCase({
                annotations: {},
                body: attachTestBodyResourceAttachments(function resourceAttachedBody(testScope) {
                    testScope.assert.true(true);

                    return testScope.assert.collect();
                }, attachments),
                controls: {},
                definitionLocations: [ { kind: 'unknown' } ],
                title: 'uses api'
            })
        ],
        controls: {},
        title: 'root'
    });
    const collectedPlan = collectedRunPlanFromTestPlan(engine.createTestPlan(root));
    const plannedCase = collectedPlan.files[0]?.cases[0];
    const discoveredCase = collectedPlan.discoveredFiles[0]?.cases[0];

    if (plannedCase === undefined || discoveredCase === undefined) {
        throw new Error('Expected collected cases.');
    }

    return [ plannedCase, discoveredCase ];
}

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/run/collected-run-plan.test.ts',
    annotations: {},
    controls: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'collectedRunPlanFromTestPlan() carries resource attachment summaries',
            annotations: {},
            controls: {},
            body(scope) {
                const [ plannedCase, discoveredCase ] = collectedCasesWithAttachments();

                scope.assert.deepEqual(plannedCase.resourceAttachments, attachments);
                scope.assert.deepEqual(discoveredCase.resourceAttachments, attachments);

                return scope.assert.collect();
            }
        })
    ]
});
