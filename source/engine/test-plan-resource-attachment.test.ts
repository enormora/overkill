import {
    attachTestBodyResourceAttachments,
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestBodyResourceAttachments
} from '../packages/engine/engine.entry-point.ts';
import { createTestEngine as createEngine } from '../test-support/create-test-engine.ts';
import type { TestCaseOptions } from './test-node.ts';

function plainDataShape(value: unknown): unknown {
    const { parse } = JSON;
    const { stringify } = JSON;

    return parse(stringify(value));
}

function resourceAttachments(): TestBodyResourceAttachments {
    return {
        directResources: [ { key: 'scratch', resourceName: 'scratch' } ],
        resourceGraph: [
            {
                dependencies: [],
                name: 'scratch',
                requirements: [],
                scope: 'per-case'
            }
        ],
        runtimeGraphs: []
    };
}

function attachedBody(attachments: TestBodyResourceAttachments): TestCaseOptions['body'] {
    return attachTestBodyResourceAttachments(function resourceAttachedBody(testScope) {
        testScope.assert.true(true);

        return testScope.assert.collect();
    }, attachments);
}

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/engine/test-plan-resource-attachment.test.ts',
    annotations: {},
    controls: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'createTestPlan() reads resource attachments from cases and table rows',
            annotations: {},
            controls: {},
            body(scope) {
                const engine = createEngine();
                const attachments = resourceAttachments();
                const root = engine.createRoot({
                    children: [
                        engine.createTestCase({
                            definitionLocations: [ { kind: 'unknown' } ],
                            body: attachedBody(attachments),
                            annotations: {},
                            controls: {},
                            title: 'uses scratch'
                        }),
                        engine.createTable({
                            definitionLocations: [ { kind: 'unknown' } ],
                            cases: [
                                {
                                    annotations: {},
                                    body: attachedBody(attachments),
                                    controls: {},
                                    parameters: { value: 1 },
                                    title: 'row 1'
                                },
                                {
                                    annotations: {},
                                    body: attachedBody(attachments),
                                    controls: {},
                                    parameters: { value: 2 },
                                    title: 'row 2'
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
                const testPlan = engine.createTestPlan(root);

                scope.assert.deepEqual(
                    plainDataShape(testPlan.cases.map(function toAttachments(testCase) {
                        return testCase.resourceAttachments;
                    })),
                    [ resourceAttachments(), resourceAttachments(), resourceAttachments() ]
                );

                return scope.assert.collect();
            }
        })
    ]
});
