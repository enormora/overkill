import { glob } from 'node:fs/promises';
import { createSuite, createTestCase, type TestScope } from '../packages/engine/engine.entry-point.ts';
import { defaultAttachmentLimits } from '../engine/runtime-attachment.ts';
import { attachmentRunFixture } from '../test-support/attachment-run-fixture.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import { createAttachmentRecord } from './attachment-record.ts';
import { createAttachmentStorageSession } from './attachment-storage-session.ts';
import { createAttachmentRunCoordinator } from './attachment-coordinator.ts';
import { createAttachmentStore, type AttachmentStore } from './attachment-store.ts';

const definition = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;

async function assertMissingLimits(scope: TestScope): Promise<void> {
    const { resolved, dependencies } = await attachmentRunFixture(scope);
    const record = await createAttachmentRecord(resolved, dependencies);
    await scope.assert.rejects(async function rejectInvalidStorage() {
        await createAttachmentStorageSession({
            ...resolved,
            facts: { ...resolved.facts, execution: { ...resolved.facts.execution, attachments: null } }
        }, record);
    }, { message: 'Runtime attachments require integration limits.' });
}

async function assertCheckpointFailure(scope: TestScope): Promise<void> {
    const { resolved, dependencies } = await attachmentRunFixture(scope);
    let writable = true;
    const record = await createAttachmentRecord(resolved, {
        ...dependencies,
        runtimeStateStore: {
            ...dependencies.runtimeStateStore,
            async write(filePath, content) {
                if (!writable) {
                    throw new Error('record storage unavailable');
                }
                await dependencies.runtimeStateStore.write(filePath, content);
            }
        }
    });
    writable = false;
    await scope.assert.rejects(async function rejectCheckpoint() {
        await record.checkpoint([]);
    }, { message: `Failed to persist run record during checkpoint: ${record.session.path}.` });
}

async function assertFinalization(scope: TestScope): Promise<void> {
    const { resolved, dependencies } = await attachmentRunFixture(scope);
    const record = await createAttachmentRecord(resolved, dependencies);
    const coordinator = createAttachmentRunCoordinator(
        await createAttachmentStorageSession({
            ...resolved,
            facts: {
                ...resolved.facts,
                execution: {
                    ...resolved
                        .facts
                        .execution,
                    retries: null
                }
            }
        }, record)
    );
    await coordinator.execution.context.forProducer({ kind: 'case' }).json({
        name: 'setup',
        mediaType: 'application/json'
    }, true);
    const final = await coordinator.finalize(
        runResultFactory.build({ summary: { passed: 1, planned: 1, discovered: 1, defined: 1 } })
    );
    scope.assert.equal(final.artifacts.length, 1);
    scope.assert.equal(await coordinator.finalize(final), final);
    await coordinator.close();
    scope.assert.equal(coordinator.artifacts().length, 1);
}

function rejectCaptureClock(cause: unknown): never {
    throw cause;
}
async function assertRejectedClock(scope: TestScope, cause: unknown, message: string): Promise<void> {
    const { resolved } = await attachmentRunFixture(scope);
    const directory = resolved.config.runtimeStateDir;
    const store = createAttachmentStore({
        witnessDirectory: `${directory}/witnesses`,
        projectRoot: resolved.cwd,
        directory,
        limits: defaultAttachmentLimits,
        work: [],
        captureTime() {
            return rejectCaptureClock(cause);
        },
        async checkpoint() {
            return undefined;
        }
    });
    const response = await store.exchange('test', {
        kind: 'open',
        branch: null,
        contentKind: 'binary',
        metadata: { name: 'screenshot', mediaType: 'image/png' },
        owner: { kind: 'run' },
        producer: { kind: 'case' }
    });
    scope.assert.deepEqual(response, { kind: 'error', message, reason: 'operation-error' });
    scope.assert.deepEqual(store.artifacts(), []);
    scope.assert.deepEqual(await Array.fromAsync(glob('**/*.attachment.bin', { cwd: directory })), []);
}
async function assertClockFailure(scope: TestScope): Promise<void> {
    await assertRejectedClock(scope, new Error('clock unavailable'), 'clock unavailable');
    await assertRejectedClock(scope, null, 'Attachment operation failed.');
}

async function checkpointPreparedEvidence(
    store: AttachmentStore,
    work: Parameters<AttachmentStore['settleAttempt']>[0],
    capture: 'attempt' | 'lifetime'
): Promise<void> {
    await store.exchange('test', { kind: 'resource-consumer', boundary: 'diagnostic-boundary', work });
    const opened = await store.exchange('test', {
        kind: 'prepare',
        branch: null,
        contentKind: 'binary',
        metadata: { name: 'prepared-evidence', mediaType: 'application/json' },
        owner: capture === 'attempt' ? { kind: 'case', work, attempt: { index: 0 } } : { kind: 'run' },
        condition: capture === 'attempt'
            ? { kind: 'attempt', work, attempt: { index: 0 } }
            : { kind: 'resource', resource: 'diagnostic', boundary: 'diagnostic-boundary' },
        producer: { kind: 'resource', name: 'diagnostic' },
        source: capture === 'attempt' ? 'native' : 'instrumented',
        subtype: capture === 'attempt' ? 'witness' : 'attachment'
    });
    if (opened.kind !== 'opened') {
        throw new TypeError('Expected a prepared witness writer.');
    }
    await store.exchange('test', {
        kind: 'write',
        writer: opened.writer,
        data: Buffer.from('{"version":1}').toString('base64')
    });
    await store.exchange('test', { kind: 'close', writer: opened.writer, reason: 'complete' });
}
async function assertInterruptedPreparation(scope: TestScope, capture: 'attempt' | 'lifetime'): Promise<void> {
    const { resolved } = await attachmentRunFixture(scope);
    const work = resolved.facts.cases[0]?.workId;
    scope.require.defined(work);
    const store = createAttachmentStore({
        witnessDirectory: `${resolved.config.runtimeStateDir}/witnesses`,
        projectRoot: resolved.cwd,
        directory: resolved.config.runtimeStateDir,
        limits: defaultAttachmentLimits,
        work: [ work ],
        captureTime() {
            return 0;
        },
        async checkpoint() {
            return undefined;
        }
    });
    await checkpointPreparedEvidence(store, work, capture);
    store.settleResult(runResultFactory.build({ status: 'failed', runnerErrors: [ { subtype: 'crash' } ] }));
    scope.assert.deepEqual(
        store.selectedArtifacts().map(function name(artifact) {
            return artifact.payload.name;
        }),
        [ 'prepared-evidence' ]
    );
    store.settleAttempt(work, { index: 0 }, 'pass', null);
    scope.assert.deepEqual(store.selectedArtifacts(), []);
    await store.finish(null);
}

export const testNode = createSuite({
    ...definition,
    title: 'source/run/runtime-attachment-storage.test.ts',
    children: ([
        [ 'storage refuses missing integration limits', assertMissingLimits ],
        [ 'checkpoint failures reject attachment persistence', assertCheckpointFailure ],
        [ 'finalization remains idempotent with the default retry policy', assertFinalization ],
        [ 'capture clock failures remove newly allocated attachment files', assertClockFailure ],
        [ 'completed witness evidence survives an interrupted attempt', async function (scope: TestScope) {
            await assertInterruptedPreparation(scope, 'attempt');
        } ],
        [ 'shared lifetime evidence survives an interrupted consumer', async function (scope: TestScope) {
            await assertInterruptedPreparation(scope, 'lifetime');
        } ]
    ] as const)
        .map(function storageCase([ title, check ]) {
            return createTestCase({
                ...definition,
                title,
                async body(scope: TestScope) {
                    await check(scope);
                    return scope.assert.collect();
                }
            });
        })
});
const { runIfMain } = await import('../test-support/run-if-main.ts');
await runIfMain(import.meta, testNode);
