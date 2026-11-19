import { type TestScope as OverkillScope, suite, test } from '@overkill-dev/test';

import { z } from 'zod/v4';

import { defineResource } from '../resources/resources.ts';
import { testNode as sessions } from './projected-resource-lifecycle-policy.test.ts';
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

export const testNode = suite({
    ...testCaseMetadata,
    title: 'source/run/resource-lifecycle-projection.test.ts',
    children: [
        sessions,
        test({
            ...testCaseMetadata,
            title: 'resource lifecycle projection preserves null payloads',
            body(scope: OverkillScope) {
                const projected = defineResource({
                    name: 'null-projection',
                    scope: 'per-run',
                    requirements: [],
                    dispose: null,
                    acquire() {
                        return 'owner';
                    },
                    serializeHandle() {
                        return null;
                    },
                    deserializeHandle() {
                        return 'consumer';
                    }
                });
                scope.assert.deepEqual(
                    z.strictObject({ payload: z.null() }).parse(serializeProjectedHandle(projected, 'owner', {})),
                    { payload: null }
                );
                scope.assert.equal(projectedHandle(projected, 'owner', {}), 'consumer');
                return scope.assert.collect();
            }
        }),
        test({
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
