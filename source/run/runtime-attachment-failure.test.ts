import { createSuite, createTestCase, type TestScope } from '../packages/engine/engine.entry-point.ts';
import { attachmentFixture, attachmentWork as work } from '../test-support/attachment-fixture.ts';
import { defaultAttachmentLimits } from '../engine/runtime-attachment.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import { testNode as integrationFailures } from './integration-failure-artifacts.test.ts';
import { createAttachmentExecution } from './attachment-execution.ts';
import {
    AttachmentOperationError,
    attachmentFailureBranch,
    attachmentFailureIdentity,
    createAttachmentFailure
} from './attachment-failure.ts';
import { resultWithRuntimeAttachments } from './attachment-results.ts';

const definition = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;
const metadata = { kind: 'text', name: 'log', mediaType: 'text/plain' } as const;
async function assertReportedError(scope: TestScope): Promise<void> {
    const { execution } = await attachmentFixture(scope, defaultAttachmentLimits);
    let failure: unknown = null;
    try {
        await execution.context.forProducer({ kind: 'case' }).json(metadata, undefined);
    } catch (error: unknown) {
        failure = error;
    }
    scope.require.instanceOf(failure, AttachmentOperationError);
    scope.assert.equal(failure.runnerError(work.case, work).subtype, 'artifact');
    scope.assert.deepEqual(await execution.finish(), []);
}
async function assertClosedActiveAttempt(scope: TestScope): Promise<void> {
    const { execution } = await attachmentFixture(scope, defaultAttachmentLimits);
    await execution.runAttempt(work, { index: 0 }, async function closeRunInsideAttempt() {
        await execution.finish();
        await scope.assert.rejects(async function rejectClosedRun() {
            await execution.context.forProducer({ kind: 'case' }).json(metadata, {});
        }, { message: 'Attachment escaped its integration run.' });
    });
    const errors = execution.takeErrors({ kind: 'run' });
    scope.assert.equal(errors[0]?.attributedToAttempt, null);
    scope.assert.equal(errors[0]?.subtype, 'attribution-drift');
}

function rejectJsonReflection(cause: unknown): never {
    throw cause;
}

async function assertHostileJson(scope: TestScope): Promise<void> {
    const { execution } = await attachmentFixture(scope, defaultAttachmentLimits);
    const value = new Proxy({}, {
        ownKeys() {
            return rejectJsonReflection(null);
        }
    });
    await scope.assert.rejects(async function rejectHostileJson() {
        await execution.context.forProducer({ kind: 'case' }).json(metadata, value);
    }, { message: 'Invalid JSON attachment.' });
    const errors = await execution.finish();
    scope.assert.equal(errors.length, 1);
    scope.assert.equal(errors[0]?.subtype, 'artifact');
}

async function assertInvalidReplies(scope: TestScope): Promise<void> {
    const execution = createAttachmentExecution(async function invalidReply() {
        return { kind: 'written' };
    }, { ...defaultAttachmentLimits, maxInlineBytes: 1024 });
    await scope.assert.rejects(async function rejectWrongOpenReply() {
        await execution.context.forProducer({ kind: 'case' }).open(metadata);
    }, { message: 'Attachment open returned an invalid reply.' });
    const openErrors = await execution.finish();
    scope.assert.equal(openErrors.length, 1);
    const closing = createAttachmentExecution(async function invalidCloseReply(operation) {
        return operation.kind === 'open' ? { kind: 'opened', writer: 0 } : { kind: 'written' };
    }, { ...defaultAttachmentLimits, maxInlineBytes: 1024 });
    const writer = await closing.context.forProducer({ kind: 'case' }).open(metadata);
    await scope.assert.rejects(async function rejectWrongCloseReply() {
        await writer.close();
    }, { message: 'Attachment close returned an invalid reply.' });
    const errors = await closing.finish();
    scope.assert.equal(errors.length, 1);
}

async function assertTransportFailure(scope: TestScope, cause: unknown, message: string): Promise<void> {
    const execution = createAttachmentExecution(async function disconnectedTransport() {
        throw cause;
    }, { ...defaultAttachmentLimits, maxInlineBytes: 1024 });
    await execution.runAttempt(work, { index: 1 }, async function rejectTransport() {
        await scope.assert.rejects(async function openFailedTransport() {
            await execution.context.forProducer({ kind: 'case' }).open(metadata);
        }, { message });
    });
    const errors = execution.takeErrors({ kind: 'case', work, attempt: { index: 1 } });
    scope.assert.equal(errors.length, 1);
    scope.assert.equal(errors[0]?.attributedToAttempt?.index, 1);
}

async function assertConsumedError(scope: TestScope): Promise<void> {
    const { execution } = await attachmentFixture(scope, defaultAttachmentLimits);
    await execution.runAttempt(work, { index: 2 }, async function reportCaughtError() {
        const failed = createAttachmentFailure({
            owner: { kind: 'case', work, attempt: { index: 2 } },
            drift: false,
            message: 'failed',
            reason: 'write-error'
        }, 'branch');
        scope.assert.equal(failed.runnerError(work.case, work).attributedToAttempt?.index, 2);
        scope.assert.equal(failed.take(), null);
    });
    const drift = createAttachmentFailure({
        owner: { kind: 'case', work, attempt: { index: 2 } },
        drift: true,
        message: 'late',
        reason: 'expired-attempt'
    }, null);
    const error = drift.runnerError(work.case, work);
    scope.assert.equal(error.attributedTo, null);
    scope.assert.equal(error.attributedToWork, null);
    scope.assert.equal(error.attributedToAttempt, null);
}

function assertFailureIdentity(scope: TestScope): void {
    const failure = createAttachmentFailure({
        owner: { kind: 'run' },
        drift: false,
        message: 'failed',
        reason: 'transport'
    }, 'branch');
    const error = failure.take();
    scope.require.defined(error);
    scope.assert.equal(attachmentFailureBranch(error), 'branch');
    const invalidCauses = [
        null,
        'text',
        { kind: 'other' },
        { kind: 'runtime-attachment-error', id: 1 },
        { kind: 'runtime-attachment-error', id: 'valid', branch: 1 }
    ];
    for (const cause of invalidCauses) {
        scope.assert.equal(attachmentFailureBranch({ ...error, cause }), null);
    }
    scope.assert.equal(
        attachmentFailureIdentity({ ...error, cause: { kind: 'runtime-attachment-error', id: 1 } }),
        null
    );
    const result = resultWithRuntimeAttachments(runResultFactory.build({ runnerErrors: [ error, error ] }), [], {
        localErrors: [],
        owners: [],
        policy: 'all',
        retainsBranch() {
            return true;
        }
    });
    scope.assert.equal(result.runnerErrors.length, 1);
}

export const testNode = createSuite({
    ...definition,
    title: 'source/run/runtime-attachment-failure.test.ts',
    children: [
        integrationFailures,
        createTestCase({
            ...definition,
            title: 'reported operation errors are consumed before final collection',
            async body(scope: TestScope) {
                await assertReportedError(scope);
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...definition,
            title: 'closing a run invalidates its active attempt capability',
            async body(scope: TestScope) {
                await assertClosedActiveAttempt(scope);
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...definition,
            title: 'JSON reflection failures become attributed attachment errors',
            async body(scope: TestScope) {
                await assertHostileJson(scope);
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...definition,
            title: 'invalid protocol replies fail instead of accepting missing artifacts',
            async body(scope: TestScope) {
                await assertInvalidReplies(scope);
                return scope.assert.collect();
            }
        }),
        ...([ [ new Error('disconnected'), 'disconnected' ], [ null, 'Attachment transport failed.' ] ] as const).map(
            function transportCase([ cause, message ]) {
                return createTestCase({
                    ...definition,
                    title: `transport failure: ${message}`,
                    async body(scope: TestScope) {
                        await assertTransportFailure(scope, cause, message);
                        return scope.assert.collect();
                    }
                });
            }
        ),
        createTestCase({
            ...definition,
            title: 'consumed errors preserve attempt attribution and drift remains run owned',
            async body(scope: TestScope) {
                await assertConsumedError(scope);
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...definition,
            title: 'failure identity rejects malformed causes and deduplicates retained errors',
            body(scope: TestScope) {
                assertFailureIdentity(scope);
                return scope.assert.collect();
            }
        })
    ]
});
const { runIfMain } = await import('../test-support/run-if-main.ts');
await runIfMain(import.meta, testNode);
