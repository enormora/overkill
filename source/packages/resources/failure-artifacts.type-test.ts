import { test } from '../test/test.entry-point.ts';
import { acceptsCall, assignableFrom, sameType } from '../type-test/type-test.entry-point.ts';
import { isEqualTo } from '../../test-support/type-relations.ts';
import {
    defineResource,
    withFailureArtifacts,
    type RuntimeAttachments,
    type FailureArtifactAttachments
} from './resources.entry-point.ts';

const owner = defineResource({
    name: 'service',
    scope: 'per-run',
    requirements: [],
    acquire() {
        return { secret: 'owner' };
    },
    dispose: null,
    serializeHandle() {
        return { url: 'http://localhost' };
    },
    deserializeHandle() {
        return { url: 'http://localhost' };
    }
});

export const testNode = test(
    'failure preparation receives the owner handle and attempt-only witnesses',
    function (scope) {
        const decorated = withFailureArtifacts(owner, function (capture) {
            scope.assert(sameType.withActual<string>(), capture.handle.secret);
            scope.assert(assignableFrom.not<keyof typeof capture.handle, 'url'>());
            if (capture.kind === 'attempt') {
                scope.assert(
                    sameType.withActual<true>(),
                    isEqualTo<FailureArtifactAttachments>()(capture.attachments)
                );
                scope.assert(acceptsCall, async function () {
                    return capture.attachments.witness({
                        producedBy: { library: 'simulation', libraryVersion: '1.0.0' },
                        simulation: { name: 'service', payload: { version: 1 } },
                        scenario: 'default',
                        seed: null,
                        runtimeSnapshot: null,
                        faultConfiguration: null
                    });
                });
            } else {
                scope.assert(sameType.withActual<true>(), isEqualTo<RuntimeAttachments>()(capture.attachments));
                scope.assert(assignableFrom.not<keyof typeof capture.attachments, 'witness'>());
            }
        });
        scope.assert(sameType.withActual<true>(), isEqualTo<typeof owner>()(decorated));
        return scope.assert.collect();
    }
);
