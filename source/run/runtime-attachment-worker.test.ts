import path from 'node:path';
import { createSuite, createTestCase, type TestScope } from '../packages/engine/engine.entry-point.ts';
import { defaultAttachmentLimits } from '../engine/runtime-attachment.ts';
import { resourceAttachments, type attachmentsForProducer } from '../attachments/attachment-context.ts';
import { attachmentFixture } from '../test-support/attachment-fixture.ts';
import { createAttachmentServer } from './attachment-server.ts';
import { runWithWorkerAttachments } from './attachment-worker-context.ts';
import { runWithAttachmentExecution } from './resource-lifecycle-state.ts';

const definition = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;

type AttachmentCapabilityModule = { readonly attachmentsForProducer: typeof attachmentsForProducer; };
function isAttachmentCapabilityModule(value: unknown): value is AttachmentCapabilityModule {
    return typeof value === 'object' && value !== null &&
        typeof Reflect.get(value, 'attachmentsForProducer') === 'function';
}
async function assertPackageContextSharing(scope: TestScope): Promise<void> {
    const { execution, store } = await attachmentFixture(scope, defaultAttachmentLimits);
    const moduleURL = new URL(
        `../attachments/attachment-context${path.extname(import.meta.url)}?package-copy`,
        import.meta.url
    );
    const namespace: unknown = await import(moduleURL.href);
    if (!isAttachmentCapabilityModule(namespace)) {
        throw new Error('Expected an attachment capability module.');
    }
    await runWithAttachmentExecution(execution, async function captureFromSeparatePackage() {
        await namespace.attachmentsForProducer({ kind: 'case' }).json(
            { name: 'setup', mediaType: 'application/json' },
            { ready: true }
        );
    });
    scope.assert.equal(store.artifacts().length, 1);
}

async function assertSharedLifecycleAttachments(scope: TestScope): Promise<void> {
    const { store } = await attachmentFixture(scope, defaultAttachmentLimits);
    const server = await createAttachmentServer(store, defaultAttachmentLimits);
    scope.cleanup(async function finishAttachmentServer() {
        await server.finish();
    });
    await runWithWorkerAttachments(server.endpoint, 'shared-lifecycle', async function acquireSharedResource() {
        await resourceAttachments('shared-service').json({ name: 'setup', mediaType: 'application/json' }, {
            phase: 'setup'
        });
    });
    await runWithWorkerAttachments(null, 'shared-lifecycle', async function disposeSharedResource() {
        await resourceAttachments('shared-service').json({ name: 'teardown', mediaType: 'application/json' }, {
            phase: 'teardown'
        });
    });
    scope.assert.equal(store.artifacts().length, 2);
    for (const artifact of store.artifacts()) {
        scope.assert.equal(artifact.id.scope.kind, 'run');
        scope.assert.deepEqual(artifact.payload.producer, { kind: 'resource', name: 'shared-service' });
        scope.assert.deepEqual(artifact.payload.content, {
            byteLength: artifact.payload.name === 'setup' ? 17 : 20,
            kind: 'json',
            value: { phase: artifact.payload.name }
        });
    }
}
async function assertTokenScopedAttachments(scope: TestScope): Promise<void> {
    const { store } = await attachmentFixture(scope, defaultAttachmentLimits);
    const server = await createAttachmentServer(store, defaultAttachmentLimits);
    await runWithWorkerAttachments(server.endpoint, null, async function attachWithoutSharedLifecycle() {
        await resourceAttachments('service').json({ name: 'setup', mediaType: 'application/json' }, true);
    });
    await server.finish();
    scope.assert.equal(store.artifacts().length, 1);
    const artifact = store.artifacts()[0];
    scope.require.defined(artifact);
    scope.assert.deepEqual(artifact.payload.producer, { kind: 'resource', name: 'service' });
}

export const testNode = createSuite({
    ...definition,
    title: 'source/run/runtime-attachment-worker.test.ts',
    children: [
        createTestCase({
            ...definition,
            title: 'workers without a shared lifecycle use their execution token for attachments',
            async body(scope: TestScope) {
                await assertTokenScopedAttachments(scope);
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...definition,
            title: 'separate package module instances share the active attachment context',
            async body(scope: TestScope) {
                await assertPackageContextSharing(scope);
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...definition,
            title: 'shared resource teardown keeps its attachment channel across worker tasks',
            async body(scope: TestScope) {
                await assertSharedLifecycleAttachments(scope);
                return scope.assert.collect();
            }
        })
    ]
});
const { runIfMain } = await import('../test-support/run-if-main.ts');
await runIfMain(import.meta, testNode);
