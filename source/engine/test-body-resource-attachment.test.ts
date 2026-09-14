import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestBody,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import {
    attachTestBodyResourceAttachments,
    hasTestBodyResourceAttachments,
    readTestBodyResourceAttachments,
    type TestBodyResourceAttachments
} from './test-body-resource-attachment.ts';

function passingBody(scope: OverkillScope): ReturnType<TestBody> {
    scope.assert.true(true);

    return scope.assert.collect();
}

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/engine/test-body-resource-attachment.test.ts',
    annotations: {},
    controls: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'resource attachment metadata is readable without becoming a body property',
            annotations: {},
            controls: {},
            body(scope) {
                const attachments: TestBodyResourceAttachments = {
                    directResources: [ { key: 'scratch', resourceName: 'scratch' } ],
                    resourceGraph: [
                        {
                            dependencies: [],
                            name: 'scratch',
                            requirements: [ { kind: 'exclusive-resource', name: 'scratch' } ],
                            scope: 'per-case'
                        }
                    ],
                    runtimeGraphs: []
                };
                const body = attachTestBodyResourceAttachments(passingBody, attachments);

                scope.assert.equal(hasTestBodyResourceAttachments(body), true);
                scope.assert.deepEqual(Object.keys(body), []);
                scope.assert.deepEqual(readTestBodyResourceAttachments(body), attachments);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'resource attachment metadata rejects empty and duplicate attachment',
            annotations: {},
            controls: {},
            body(scope) {
                scope.assert.throws(function attachEmptyMetadata() {
                    attachTestBodyResourceAttachments(
                        function emptyAttachmentBody(testScope: OverkillScope): ReturnType<TestBody> {
                            testScope.assert.true(true);

                            return testScope.assert.collect();
                        },
                        {
                            directResources: [],
                            resourceGraph: [],
                            runtimeGraphs: []
                        }
                    );
                }, { message: 'Test body resource attachments must not be empty.' });

                const attachedBody = attachTestBodyResourceAttachments(function attached(
                    testScope: OverkillScope
                ): ReturnType<TestBody> {
                    testScope.assert.true(true);

                    return testScope.assert.collect();
                }, {
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
                });

                scope.assert.throws(function attachTwice() {
                    attachTestBodyResourceAttachments(attachedBody, {
                        directResources: [ { key: 'database', resourceName: 'database' } ],
                        resourceGraph: [
                            {
                                dependencies: [],
                                name: 'database',
                                requirements: [],
                                scope: 'per-case'
                            }
                        ],
                        runtimeGraphs: []
                    });
                }, { message: 'Test body already has resource attachments.' });

                return scope.assert.collect();
            }
        })
    ]
});
