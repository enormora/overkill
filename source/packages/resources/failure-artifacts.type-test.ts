import { expect, test } from 'tstyche';
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

test('failure preparation receives the owner handle and attempt-only witnesses', function () {
    const decorated = withFailureArtifacts(owner, function (capture) {
        expect(capture.handle.secret).type.toBe<string>();
        expect(capture.handle).type.not.toHaveProperty('url');
        if (capture.kind === 'attempt') {
            expect(capture.attachments).type.toBe<FailureArtifactAttachments>();
            expect(capture.attachments.witness).type.toBeCallableWith({
                producedBy: { library: 'simulation', libraryVersion: '1.0.0' },
                simulation: { name: 'service', payload: { version: 1 } },
                scenario: 'default',
                seed: null,
                runtimeSnapshot: null,
                faultConfiguration: null
            });
        } else {
            expect(capture.attachments).type.toBe<RuntimeAttachments>();
            expect(capture.attachments).type.not.toHaveProperty('witness');
        }
    });
    expect(decorated).type.toBe<typeof owner>();
});
