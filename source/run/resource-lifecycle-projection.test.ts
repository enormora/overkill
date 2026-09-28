import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { defineResource } from '../resources/resources.ts';
import {
    deserializeProjectedHandle,
    projectedHandle,
    serializeProjectedHandle
} from './resource-lifecycle-projection.ts';

const testCaseMetadata = {
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' as const } ]
} as const;

const databaseResource = defineResource({
    name: 'database',
    scope: 'per-case',
    requirements: [],
    acquire() {
        return 'database';
    },
    dispose: null
});

export const testNode = createOverkillSuite({
    ...testCaseMetadata,
    title: 'source/run/resource-lifecycle-projection.test.ts',
    children: [
        createOverkillTestCase({
            ...testCaseMetadata,
            title: 'resource lifecycle projection preserves local resources',
            body(scope: OverkillScope) {
                scope.assert.equal(serializeProjectedHandle(databaseResource, 'handle', {}), null);
                scope.assert.equal(projectedHandle(databaseResource, 'handle', {}), 'handle');
                scope.assert.throws(function deserializeLocalResource() {
                    deserializeProjectedHandle(databaseResource, 'handle', {});
                }, {
                    message: 'Resource "database" requires a projection for worker-pool per-run ownership.'
                });

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
