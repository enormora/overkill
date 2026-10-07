import {
    createSuite,
    createTestCase,
    type TestScope,
    type HedgedConflictArtifact,
    type RunArtifact
} from '../packages/engine/engine.entry-point.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import { attachmentFixture, attachmentWork as work } from '../test-support/attachment-fixture.ts';
import { defaultAttachmentLimits } from '../engine/runtime-attachment.ts';
import { attachmentArtifacts, attachmentMatchesAttempt, resultWithRuntimeAttachments } from './attachment-results.ts';
import { createAttachmentFailure } from './attachment-failure.ts';

const definition = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;
const metadata = { name: 'attempt-log', mediaType: 'text/plain' };
const retainEveryBranch = function retainEveryBranch(): boolean {
    return true;
};

async function assertResultOwnership(scope: TestScope): Promise<void> {
    const { execution, store } = await attachmentFixture(scope, defaultAttachmentLimits);
    await execution.runAttempt(work, { index: 1 }, async function captureAttempt() {
        await execution.context.forProducer({ kind: 'case' }).json({ ...metadata, mediaType: 'application/json' }, {
            ready: true
        });
    });
    const artifact = store.artifacts()[0];
    scope.require.defined(artifact);
    scope.assert.true(attachmentMatchesAttempt(artifact, work, { index: 1 }));
    scope.assert.false(attachmentMatchesAttempt(artifact, work, { index: 0 }));
    scope.assert.false(
        attachmentMatchesAttempt(artifact, { ...work, case: { ...work.case, title: 'other' } }, { index: 1 })
    );
    const result = resultWithRuntimeAttachments(runResultFactory.build({ artifacts: [ artifact ] }), [ artifact ], {
        localErrors: [],
        owners: [ { kind: 'run' }, { kind: 'case', work, attempt: { index: 1 } } ],
        policy: 'all',
        retainsBranch: retainEveryBranch
    });
    scope.assert.equal(result.artifacts.length, 1);
    scope.assert.equal(result.runnerErrors.length, 2);
}

function assertCancelledErrors(scope: TestScope): void {
    const failure = createAttachmentFailure({
        owner: { kind: 'run' },
        drift: false,
        reason: 'write-error',
        message: 'cancelled peer'
    }, 'cancelled');
    const error = failure.take();
    scope.require.defined(error);
    const result = runResultFactory.build({
        runnerErrors: [ error ],
        summary: { passed: 1, planned: 1, discovered: 1, defined: 1 }
    });
    scope.assert.equal(result.status, 'failed');
    const retained = resultWithRuntimeAttachments(result, [], {
        localErrors: [],
        owners: [],
        policy: 'all',
        retainsBranch(branch) {
            return branch !== 'cancelled';
        }
    });
    scope.assert.equal(retained.status, 'passed');
    scope.assert.deepEqual(retained.runnerErrors, []);
}

function assertConflictAttempts(scope: TestScope, artifact: RunArtifact | undefined): void {
    scope.require.defined(artifact);
    if (artifact.payload.kind !== 'hedged-conflict') {
        throw new Error('Expected conflict evidence.');
    }
    for (const evidence of [ artifact.payload.authoritative, artifact.payload.conflicting ]) {
        scope.assert.deepEqual(
            evidence.attachments.map(function retainedAttempt(attachment) {
                return attachment.id.attempt?.index;
            }),
            [ 1, 2 ]
        );
    }
}

async function assertConflictRetention(scope: TestScope): Promise<void> {
    const { execution, store } = await attachmentFixture(scope, defaultAttachmentLimits);
    for (const index of [ 0, 1, 2 ]) {
        await execution.runAttempt(work, { index }, async function writeRetryEvidence() {
            const writer = await execution.context.forProducer({ kind: 'case' }).open({ ...metadata, kind: 'text' });
            await writer.write(`attempt ${index}`);
            await writer.close();
        });
    }
    const first = store.artifacts()[0];
    scope.require.defined(first);
    const evidence: HedgedConflictArtifact['payload']['authoritative'] = {
        attachments: store.artifacts(),
        outcome: { kind: 'pass' },
        verdict: 'pass',
        attempts: [
            { attempt: { index: 0 }, durationMicroseconds: 0, outcome: null, verdict: 'fail' },
            { attempt: { index: 1 }, durationMicroseconds: 0, outcome: null, verdict: 'fail' },
            { attempt: { index: 2 }, durationMicroseconds: 0, outcome: { kind: 'pass' }, verdict: 'pass' }
        ]
    };
    const conflict: HedgedConflictArtifact = {
        id: { ...first.id, subtype: 'hedged-conflict' },
        source: 'native',
        payload: { kind: 'hedged-conflict', work, authoritative: evidence, conflicting: evidence }
    };
    scope.assert.equal(attachmentArtifacts([ conflict ]).length, 6);
    const result = resultWithRuntimeAttachments(runResultFactory.build({ artifacts: [ conflict ] }), [], {
        localErrors: [],
        owners: [],
        policy: 'last-failure-and-final',
        retainsBranch: retainEveryBranch
    });
    assertConflictAttempts(scope, result.artifacts[0]);
}

async function assertIndependentOutputSequence(scope: TestScope): Promise<void> {
    const { execution, store } = await attachmentFixture(scope, defaultAttachmentLimits);
    await execution.context.forProducer({ kind: 'case' }).json(metadata, { ready: true });
    const attachment = store.artifacts()[0];
    scope.require.defined(attachment);
    const output: RunArtifact = {
        id: { ...attachment.id, subtype: 'log-capture' },
        source: 'native',
        payload: {
            kind: 'captured-output',
            capturedAtMicroseconds: 0,
            stream: 'stdout',
            text: 'ready',
            byteLength: 5,
            truncated: false
        }
    };
    const result = resultWithRuntimeAttachments(runResultFactory.build({ artifacts: [ output ] }), store.artifacts(), {
        localErrors: [],
        owners: [],
        policy: 'all',
        retainsBranch: retainEveryBranch
    });
    scope.assert.equal(result.artifacts.length, 2);
    scope.assert.deepEqual(attachmentArtifacts(result.artifacts), store.artifacts());
}
export const testNode = createSuite({
    ...definition,
    title: 'source/run/runtime-attachment-results.test.ts',
    children: [
        createTestCase({
            ...definition,
            title: 'console captures do not collide with resource attachment sequences',
            async body(scope: TestScope) {
                await assertIndependentOutputSequence(scope);
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...definition,
            title: 'result merging matches attempt identities, deduplicates artifacts, and reports abandoned owners',
            async body(scope: TestScope) {
                await assertResultOwnership(scope);
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...definition,
            title: 'discarded branch attachment errors do not fail retained execution',
            body(scope: TestScope) {
                assertCancelledErrors(scope);
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...definition,
            title: 'hedged conflict evidence applies retry retention to both executions',
            async body(scope: TestScope) {
                await assertConflictRetention(scope);
                return scope.assert.collect();
            }
        })
    ]
});
const { runIfMain } = await import('../test-support/run-if-main.ts');
await runIfMain(import.meta, testNode);
