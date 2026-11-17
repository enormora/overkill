import { runIfMain } from '#test-runner';
import {
    defineResource,
    defineRuntime,
    defineRuntimeMatrix,
    type AnyResourceDefinition
} from '../resources/resources.entry-point.ts';
import { testNode as inputPolicy } from './resource-input-policy.test.ts';
import { suite, test, type TestScope } from './test.entry-point.ts';
import { buildStepAttachments } from './resource-wrapper-metadata.ts';

function fixedValueResource(name: string): AnyResourceDefinition {
    return defineResource({
        name,
        scope: 'per-case',
        requirements: [],
        acquire() {
            return 42;
        },
        dispose: null
    });
}
export const testNode = suite('resource wrapper attachment metadata', [
    inputPolicy,
    test('rejects different resource descriptors sharing a name', function (scope: TestScope) {
        scope.assert.throws(function () {
            buildStepAttachments([ {
                kind: 'resources',
                resources: { first: fixedValueResource('shared'), second: fixedValueResource('shared') }
            } ]);
        }, { message: 'Resource name "shared" is used by multiple descriptors.' });
        return scope.assert.collect();
    }),
    test('records matrix variants and their shared resource graph', function (scope: TestScope) {
        const owner = fixedValueResource('owner');
        const matrix = defineRuntimeMatrix({
            name: 'api',
            variants: {
                first: defineRuntime({
                    name: 'first',
                    dimensions: { version: '1' },
                    resources: { owner },
                    requirements: []
                }),
                second: defineRuntime({
                    name: 'second',
                    dimensions: { version: '2' },
                    resources: { owner },
                    requirements: []
                })
            }
        });
        const attachments = buildStepAttachments([ { kind: 'runtime', runtime: matrix } ]);
        scope.assert.deepEqual(
            attachments.resourceGraph.map(function (entry) {
                return entry.name;
            }),
            [ 'owner' ]
        );
        scope.assert.partialDeepEqual(attachments.runtimeGraphs, [ {
            kind: 'runtime-matrix',
            name: 'api',
            resources: [ { key: 'owner', resourceName: 'owner' } ],
            variants: [ { id: 'first', runtime: { dimensions: { version: '1' } } }, {
                id: 'second',
                runtime: { dimensions: { version: '2' } }
            } ]
        } ]);
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);
