import { test } from '../../../tools/type-tests/authoring.entry-point.ts';
import { acceptsCall, assignableFrom, sameType } from '../../../tools/type-tests/relations.entry-point.ts';
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
    function (typeScope) {
        const decorated = withFailureArtifacts(owner, function (capture) {
            typeScope.assert(sameType.withActual<string>(), capture.handle.secret);
            typeScope.assert(assignableFrom.not<keyof typeof capture.handle, 'url'>());
            if (capture.kind === 'attempt') {
                typeScope.assert(sameType.withActual<FailureArtifactAttachments>(), capture.attachments);
                typeScope.assert(acceptsCall, async () =>
                    capture.attachments.witness({
                        producedBy: { library: 'simulation', libraryVersion: '1.0.0' },
                        simulation: { name: 'service', payload: { version: 1 } },
                        scenario: 'default',
                        seed: null,
                        runtimeSnapshot: null,
                        faultConfiguration: null
                    }));
            } else {
                typeScope.assert(sameType.withActual<RuntimeAttachments>(), capture.attachments);
                typeScope.assert(assignableFrom.not<keyof typeof capture.attachments, 'witness'>());
            }
        });
        typeScope.assert(sameType.withActual<typeof owner>(), decorated);
        return typeScope.assert.collect();
    }
);
