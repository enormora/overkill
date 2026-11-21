import { glob } from 'node:fs/promises';
import { defineMacro, suite, test, table, type TestScope } from '@overkill-dev/test';

import { defaultAttachmentLimits } from '../../../engine/runtime-attachment.ts';
import { attachmentRunFixture } from '../../../test-support/attachment-run-fixture.ts';
import { runResultFactory } from '../../../test-support/run-result-factory.ts';
import { createAttachmentRecord } from '../../../run/attachment-record.ts';
import { createAttachmentStorageSession } from '../../../run/attachment-storage-session.ts';
import { createAttachmentRunCoordinator } from '../../../run/attachment-coordinator.ts';
import { createAttachmentStore, type AttachmentStore } from '../../../run/attachment-store.ts';

function rejectCaptureClock(cause: unknown): never {
    throw cause;
}
const assertRejectedClock = defineMacro((title: string, cause: unknown, message: string) =>
    test(title, async (scope) => {
        const { resolved } = await attachmentRunFixture(scope.cleanup);
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

        return scope.assert.collect();
    })
);
const assertClockFailure = defineMacro((title: string) =>
    suite(title, [
        assertRejectedClock('rejected clock', new Error('clock unavailable'), 'clock unavailable'),
        assertRejectedClock('rejected clock', null, 'Attachment operation failed.')
    ])
);

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
async function preparedEvidenceStore(cleanup: TestScope['cleanup']): Promise<{
    readonly store: AttachmentStore;
    readonly work: Parameters<AttachmentStore['settleAttempt']>[0];
}> {
    const { resolved } = await attachmentRunFixture(cleanup);
    const work = resolved.facts.cases[0]?.workId;
    if (work === undefined || work === null) {
        throw new Error('Expected fixture work.');
    }
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

export const testNode = suite('Runtime attachment storage', [
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
        caseTitle({ kind, closed }) {
            return kind + (closed ? ', completed' : ', interrupted');
        },
        async test(scope) {
            const unknownAttemptPrefixKind: 'binary' | 'json' | 'text' = scope.parameters.kind;
            const unknownAttemptPrefixClosed: boolean = scope.parameters.closed;
            const { store, work } = await preparedEvidenceStore(scope.cleanup);
            await checkpointPreparedEvidence(store, work, {
                capture: 'attempt',
                contentKind: unknownAttemptPrefixKind,
                closed: unknownAttemptPrefixClosed
            });
            store.settleResult(runResultFactory.build({ status: 'failed', runnerErrors: [ { subtype: 'artifact' } ] }));
            scope.assert.deepEqual(await store.finish('test'), []);
            scope.assert.equal(
                store.selectedArtifacts().length,
                !unknownAttemptPrefixClosed && unknownAttemptPrefixKind !== 'json' ? 1 : 0
            );

            return scope.assert.collect();
        }
    }),
    test('unknown consumers discard shared evidence unless their resource fails', async (scope) => {
        const { store, work } = await preparedEvidenceStore(scope.cleanup);
        await checkpointPreparedEvidence(store, work, { capture: 'lifetime', contentKind: 'text', closed: true });
        store.settleResult(runResultFactory.build({ status: 'failed', runnerErrors: [ { subtype: 'artifact' } ] }));
        scope.assert.deepEqual(store.selectedArtifacts(), []);
        await store.exchange('test', { kind: 'resource-failure', boundary: 'diagnostic-boundary' });
        scope.assert.equal(store.selectedArtifacts().length, 1);

        return scope.assert.collect();
    }),
    test('refuses missing integration limits', async (scope) => {
        const { resolved, dependencies } = await attachmentRunFixture(scope.cleanup);
        const record = await createAttachmentRecord(resolved, dependencies, null);
        await scope.assert.rejects(async function rejectInvalidStorage() {
            await createAttachmentStorageSession({
                ...resolved,
                facts: { ...resolved.facts, execution: { ...resolved.facts.execution, attachments: null } }
            }, record);
        }, { message: 'Runtime attachments require integration limits.' });

        return scope.assert.collect();
    }),
    test('checkpoint failures reject attachment persistence', async (scope) => {
        const { resolved, dependencies } = await attachmentRunFixture(scope.cleanup);
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

        return scope.assert.collect();
    }),
    test('finalization remains idempotent with the default retry policy', async (scope) => {
        const { resolved, dependencies } = await attachmentRunFixture(scope.cleanup);
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

        return scope.assert.collect();
    }),
    assertClockFailure('capture clock failures remove newly allocated attachment files'),
    table({
        title: 'completed witness evidence survives interruption',
        cases: [ 'attempt', 'lifetime' ] as const,
        caseTitle(capture) {
            return capture;
        },
        async test(scope) {
            const interruptedPreparationCapture: 'attempt' | 'lifetime' = scope.parameters;
            const { store, work } = await preparedEvidenceStore(scope.cleanup);
            await checkpointPreparedEvidence(store, work, {
                capture: interruptedPreparationCapture,
                contentKind: 'binary',
                closed: true
            });
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

            return scope.assert.collect();
        }
    })
]);
