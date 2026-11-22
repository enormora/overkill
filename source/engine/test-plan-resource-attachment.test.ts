import { suite, test } from '@overkill-dev/test';
import { type EngineCaseBody, createTestEngine as createEngine } from '../test-support/create-test-engine.ts';

import {
    attachTestBodyResourceAttachments,
    type TestBodyResourceAttachments
} from '../packages/engine/engine.entry-point.ts';

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
    };
}

function attachedBody(attachments: TestBodyResourceAttachments): EngineCaseBody {
    return attachTestBodyResourceAttachments(function resourceAttachedBody(testScope) {
        testScope.assert.true(true);

        return testScope.assert.collect();
    }, attachments);
}

export const testNode = suite('Test plan resource attachment', [
    test('reads resource attachments from cases and table rows', function (scope) {
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
    })
]);
