import { type TestNode, type TestScope, suite, test } from '@overkill-dev/test';
import type { EngineCaseBody } from '../test-support/create-test-engine.ts';

import {
    attachTestBodyResourceAttachments,
    hasAttachedResourceDescriptors,
    hasTestBodyResourceAttachments,
    readTestBodyResourceAttachments,
    type TestBodyExecutionRequirementSummary,
    type TestBodyResourceAttachments
} from './test-body-resource-attachment.ts';

type PassingBodyAssertions = { readonly assert: Pick<TestScope['assert'], 'collect' | 'true'>; };

function passingBody(
    scope: PassingBodyAssertions
): ReturnType<EngineCaseBody> {
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
                workload: 'independent' as const,
                dependencies: [],
                handleTransport: 'local',
                name: resource.resourceName,
                requirements: [],
                scenarios: [],
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
                scenarioBindings: [],
                resources
            }
        ]
    };
}

export const testNode: TestNode = suite('Test body resource attachment', [
    test(
        'hasAttachedResourceDescriptors() reads resource descriptors from attachment metadata',
        function (scope) {
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
    ),
    test('resource attachment metadata is readable without becoming a body property', function (scope) {
        const attachments: TestBodyResourceAttachments = {
            directResources: [ { key: 'scratch', resourceName: 'scratch' } ],
            resourceGraph: [
                {
                    workload: 'independent' as const,
                    dependencies: [],
                    handleTransport: 'local',
                    name: 'scratch',
                    requirements: [ { kind: 'exclusive-resource', name: 'scratch' } ],
                    scenarios: [],
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
    }),
    test('resource attachment metadata rejects empty and duplicate attachment', function (scope) {
        scope.assert.throws(function rejectNonFunctionBody() {
            Reflect.apply(attachTestBodyResourceAttachments, undefined, [
                {},
                {
                    directResources: [ { key: 'scratch', resourceName: 'scratch' } ],
                    resourceGraph: [
                        {
                            workload: 'independent' as const,
                            dependencies: [],
                            handleTransport: 'local',
                            name: 'scratch',
                            requirements: [],
                            scenarios: [],
                            scope: 'per-case'
                        }
                    ],
                    runtimeGraphs: []
                }
            ]);
        }, { message: 'Resource attachments require a test body function.' });
        scope.assert.throws(function attachEmptyMetadata() {
            attachTestBodyResourceAttachments(
                function emptyAttachmentBody(testScope: TestScope): ReturnType<EngineCaseBody> {
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
            testScope: TestScope
        ): ReturnType<EngineCaseBody> {
            testScope.assert.true(true);

            return testScope.assert.collect();
        }, {
            directResources: [ { key: 'scratch', resourceName: 'scratch' } ],
            resourceGraph: [
                {
                    workload: 'independent' as const,
                    dependencies: [],
                    handleTransport: 'local',
                    name: 'scratch',
                    requirements: [],
                    scenarios: [],
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
                        workload: 'independent' as const,
                        dependencies: [],
                        handleTransport: 'local',
                        name: 'database',
                        requirements: [],
                        scenarios: [],
                        scope: 'per-case'
                    }
                ],
                runtimeGraphs: []
            });
        }, { message: 'Test body already has resource attachments.' });
        scope.assert.throws(function attachDuplicateResourceScope() {
            attachTestBodyResourceAttachments(function resourceDuplicateBody(
                testScope: TestScope
            ): ReturnType<EngineCaseBody> {
                testScope.assert.true(true);

                return testScope.assert.collect();
            }, {
                directResources: [
                    { key: 'scratch', resourceName: 'scratch' },
                    { key: 'scratch', resourceName: 'workspace' }
                ],
                resourceGraph: [
                    {
                        workload: 'independent' as const,
                        dependencies: [],
                        handleTransport: 'local',
                        name: 'scratch',
                        requirements: [],
                        scenarios: [],
                        scope: 'per-case'
                    },
                    {
                        workload: 'independent' as const,
                        dependencies: [],
                        handleTransport: 'local',
                        name: 'workspace',
                        requirements: [],
                        scenarios: [],
                        scope: 'per-case'
                    }
                ],
                runtimeGraphs: []
            });
        }, { message: 'Resource scope "scratch" is attached multiple times.' });
        scope.assert.throws(function attachDuplicateRuntimeScope() {
            attachTestBodyResourceAttachments(function runtimeDuplicateBody(
                testScope: TestScope
            ): ReturnType<EngineCaseBody> {
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
                        scenarioBindings: [],
                        resources: []
                    },
                    {
                        dimensions: {},
                        name: 'api',
                        requirements: [],
                        scenarioBindings: [],
                        resources: []
                    }
                ]
            });
        }, { message: 'Runtime scope "api" is attached multiple times.' });

        return scope.assert.collect();
    })
]);
