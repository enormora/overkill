import { type TestNode, suite, test, table, type TestScope } from '@overkill-dev/test';
import { glob } from 'node:fs/promises';

import { defaultAttachmentLimits } from '../../../engine/runtime-attachment.ts';
import { attachmentRunFixture } from '../../../test-support/attachment-run-fixture.ts';
import { runResultFactory } from '../../../test-support/run-result-factory.ts';
import { createAttachmentRecord } from '../../../run/attachment-record.ts';
import { createAttachmentStorageSession } from '../../../run/attachment-storage-session.ts';
import { createAttachmentRunCoordinator } from '../../../run/attachment-coordinator.ts';
import { createAttachmentStore, type AttachmentStore } from '../../../run/attachment-store.ts';

async function assertMissingLimits(scope: TestScope): Promise<void> {
    const { resolved, dependencies } = await attachmentRunFixture(scope);
    const record = await createAttachmentRecord(resolved, dependencies, null);
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
    }, null);
    writable = false;
    await scope.assert.rejects(async function rejectCheckpoint() {
        await record.checkpoint([]);
    }, { message: `Failed to persist run record during checkpoint: ${record.session.path}.` });
}

async function assertFinalization(scope: TestScope): Promise<void> {
    const { resolved, dependencies } = await attachmentRunFixture(scope);
    const record = await createAttachmentRecord(resolved, dependencies, null);
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

type EvidencePreparation = {
    readonly capture: 'attempt' | 'lifetime';
    readonly contentKind: 'binary' | 'json' | 'text';
    readonly closed: boolean;
};
type EvidenceOrigin = { readonly source: 'instrumented' | 'native'; readonly subtype: 'attachment' | 'witness'; };
function evidenceOrigin(preparation: EvidencePreparation): EvidenceOrigin {
    const native = preparation.capture === 'attempt' && preparation.contentKind === 'binary';
    return native ? { source: 'native', subtype: 'witness' } : { source: 'instrumented', subtype: 'attachment' };
}
async function checkpointPreparedEvidence(
    store: AttachmentStore,
    work: Parameters<AttachmentStore['settleAttempt']>[0],
    preparation: EvidencePreparation
): Promise<void> {
    const { capture, contentKind, closed } = preparation;
    await store.exchange('test', { kind: 'resource-consumer', boundary: 'diagnostic-boundary', work });
    const opened = await store.exchange('test', {
        kind: 'prepare',
        branch: null,
        contentKind,
        metadata: { name: 'prepared-evidence', mediaType: 'application/json' },
        owner: capture === 'attempt' ? { kind: 'case', work, attempt: { index: 0 } } : { kind: 'run' },
        condition: capture === 'attempt'
            ? { kind: 'attempt', work, attempt: { index: 0 } }
            : { kind: 'resource', resource: 'diagnostic', boundary: 'diagnostic-boundary' },
        producer: { kind: 'resource', name: 'diagnostic' },
        ...evidenceOrigin(preparation)
    });
    if (opened.kind !== 'opened') {
        throw new TypeError('Expected a prepared witness writer.');
    }
    await store.exchange('test', {
        kind: 'write',
        writer: opened.writer,
        data: Buffer.from('{"version":1}').toString('base64')
    });
    if (closed) {
        await store.exchange('test', { kind: 'close', writer: opened.writer, reason: 'complete' });
    }
}
async function preparedEvidenceStore(scope: TestScope): Promise<{
    readonly store: AttachmentStore;
    readonly work: Parameters<AttachmentStore['settleAttempt']>[0];
}> {
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
    return { store, work };
}
async function assertInterruptedPreparation(scope: TestScope, capture: 'attempt' | 'lifetime'): Promise<void> {
    const { store, work } = await preparedEvidenceStore(scope);
    await checkpointPreparedEvidence(store, work, { capture, contentKind: 'binary', closed: true });
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
async function assertUnknownAttemptPrefix(
    scope: TestScope,
    kind: 'binary' | 'json' | 'text',
    closed: boolean
): Promise<void> {
    const { store, work } = await preparedEvidenceStore(scope);
    await checkpointPreparedEvidence(store, work, { capture: 'attempt', contentKind: kind, closed });
    store.settleResult(runResultFactory.build({ status: 'failed', runnerErrors: [ { subtype: 'artifact' } ] }));
    scope.assert.deepEqual(await store.finish('test'), []);
    scope.assert.equal(store.selectedArtifacts().length, !closed && kind !== 'json' ? 1 : 0);
}
async function assertUnknownLifetime(scope: TestScope): Promise<void> {
    const { store, work } = await preparedEvidenceStore(scope);
    await checkpointPreparedEvidence(store, work, { capture: 'lifetime', contentKind: 'text', closed: true });
    store.settleResult(runResultFactory.build({ status: 'failed', runnerErrors: [ { subtype: 'artifact' } ] }));
    scope.assert.deepEqual(store.selectedArtifacts(), []);
    await store.exchange('test', { kind: 'resource-failure', boundary: 'diagnostic-boundary' });
    scope.assert.equal(store.selectedArtifacts().length, 1);
}

export const testNode: TestNode = suite('Runtime attachment storage', [
    table({
        title: 'unknown attempts retain only interrupted prefixes',
        cases: [
            { kind: 'binary', closed: false },
            { kind: 'binary', closed: true },
            { kind: 'json', closed: false },
            { kind: 'json', closed: true },
            { kind: 'text', closed: false },
            { kind: 'text', closed: true }
        ] as const,
        caseTitle: ({ kind, closed }) => kind + (closed ? ', completed' : ', interrupted'),
        async test(scope) {
            await assertUnknownAttemptPrefix(scope, scope.parameters.kind, scope.parameters.closed);
            return scope.assert.collect();
        }
    }),
    test('unknown consumers discard shared evidence unless their resource fails', async (scope) => {
        await assertUnknownLifetime(scope);
        return scope.assert.collect();
    }),
    test('refuses missing integration limits', async (scope) => {
        await assertMissingLimits(scope);
        return scope.assert.collect();
    }),
    test('checkpoint failures reject attachment persistence', async (scope) => {
        await assertCheckpointFailure(scope);
        return scope.assert.collect();
    }),
    test('finalization remains idempotent with the default retry policy', async (scope) => {
        await assertFinalization(scope);
        return scope.assert.collect();
    }),
    test('capture clock failures remove newly allocated attachment files', async (scope) => {
        await assertClockFailure(scope);
        return scope.assert.collect();
    }),
    table({
        title: 'completed witness evidence survives interruption',
        cases: [ 'attempt', 'lifetime' ] as const,
        caseTitle: (capture) => capture,
        async test(scope) {
            await assertInterruptedPreparation(scope, scope.parameters);
            return scope.assert.collect();
        }
    })
]);
