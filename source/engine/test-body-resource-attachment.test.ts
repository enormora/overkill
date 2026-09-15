import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestBody,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import {
    attachTestBodyResourceAttachments,
    hasAttachedResourceDescriptors,
    hasTestBodyResourceAttachments,
    readTestBodyResourceAttachments,
    type TestBodyExecutionRequirementSummary,
    type TestBodyResourceAttachments
} from './test-body-resource-attachment.ts';

function passingBody(scope: OverkillScope): ReturnType<TestBody> {
    scope.assert.true(true);

    return scope.assert.collect();
}

function resourceAttachments(
    resources: readonly { readonly key: string; readonly resourceName: string; }[]
): TestBodyResourceAttachments {
    return {
        directResources: [],
        resourceGraph: resources.map(function toResource(resource) {
            return {
                dependencies: [],
                name: resource.resourceName,
                requirements: [],
                scope: 'per-case'
            };
        }),
        runtimeGraphs: []
    };
}

function runtimeAttachments(
    resources: readonly { readonly key: string; readonly resourceName: string; }[],
    requirements: readonly TestBodyExecutionRequirementSummary[]
): TestBodyResourceAttachments {
    return {
        directResources: [],
        resourceGraph: [],
        runtimeGraphs: [
            {
                dimensions: {},
                name: 'runtime',
                requirements,
                resources
            }
        ]
    };
}

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/engine/test-body-resource-attachment.test.ts',
    annotations: {},
    controls: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'hasAttachedResourceDescriptors() reads resource descriptors from attachment metadata',
            annotations: {},
            controls: {},
            body(scope) {
                scope.assert.equal(
                    hasAttachedResourceDescriptors({
                        directResources: [],
                        resourceGraph: [],
                        runtimeGraphs: []
                    }),
                    false
                );
                scope.assert.equal(
                    hasAttachedResourceDescriptors({
                        directResources: [ { key: 'database', resourceName: 'database' } ],
                        resourceGraph: [],
                        runtimeGraphs: []
                    }),
                    true
                );
                scope.assert.equal(
                    hasAttachedResourceDescriptors(resourceAttachments([
                        { key: 'database', resourceName: 'database' }
                    ])),
                    true
                );
                scope.assert.equal(
                    hasAttachedResourceDescriptors(runtimeAttachments([
                        { key: 'database', resourceName: 'database' }
                    ], [])),
                    true
                );
                scope.assert.equal(
                    hasAttachedResourceDescriptors(runtimeAttachments([], [
                        { kind: 'startup-budget-milliseconds', minimumMilliseconds: 1000 }
                    ])),
                    false
                );

                return scope.assert.collect();
            }
        }),
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
                scope.assert.throws(function attachDuplicateResourceScope() {
                    attachTestBodyResourceAttachments(function resourceDuplicateBody(
                        testScope: OverkillScope
                    ): ReturnType<TestBody> {
                        testScope.assert.true(true);

                        return testScope.assert.collect();
                    }, {
                        directResources: [
                            { key: 'scratch', resourceName: 'scratch' },
                            { key: 'scratch', resourceName: 'workspace' }
                        ],
                        resourceGraph: [
                            {
                                dependencies: [],
                                name: 'scratch',
                                requirements: [],
                                scope: 'per-case'
                            },
                            {
                                dependencies: [],
                                name: 'workspace',
                                requirements: [],
                                scope: 'per-case'
                            }
                        ],
                        runtimeGraphs: []
                    });
                }, { message: 'Resource scope "scratch" is attached multiple times.' });
                scope.assert.throws(function attachDuplicateRuntimeScope() {
                    attachTestBodyResourceAttachments(function runtimeDuplicateBody(
                        testScope: OverkillScope
                    ): ReturnType<TestBody> {
                        testScope.assert.true(true);

                        return testScope.assert.collect();
                    }, {
                        directResources: [],
                        resourceGraph: [],
                        runtimeGraphs: [
                            {
                                dimensions: {},
                                name: 'api',
                                requirements: [],
                                resources: []
                            },
                            {
                                dimensions: {},
                                name: 'api',
                                requirements: [],
                                resources: []
                            }
                        ]
                    });
                }, { message: 'Runtime scope "api" is attached multiple times.' });

                return scope.assert.collect();
            }
        })
    ]
});
