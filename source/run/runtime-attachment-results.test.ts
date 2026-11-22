import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { defineMacro, suite, test, type TestScope } from '@overkill-dev/test';

import type { HedgedConflictArtifact, RunArtifact } from '../packages/engine/engine.entry-point.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import {
    inlineAttachmentFixture,
    type AttachmentFixture,
    attachmentWork as work
} from '../test-support/attachment-fixture.ts';
import { defaultAttachmentLimits, type RuntimeAttachmentArtifact } from '../engine/runtime-attachment.ts';
import { attachmentArtifacts, attachmentMatchesAttempt, resultWithRuntimeAttachments } from './attachment-results.ts';
import { createAttachmentFailure } from './attachment-failure.ts';

const metadata = { name: 'attempt-log', mediaType: 'text/plain' };
const retainEveryBranch = function retainEveryBranch(): boolean {
    return true;
};

const assertResultOwnership = defineMacro(function (title: string) {
    return test(title, async function (scope: TestScope) {
        const { execution, store } = inlineAttachmentFixture(defaultAttachmentLimits, [ work ]);
        await execution.runAttempt(work, { index: 1 }, async function captureAttempt() {
            await execution.context.forProducer({ kind: 'case' }).json({ ...metadata, mediaType: 'application/json' }, {
                ready: true
            });
        });
        const artifact = store.artifacts()[0];
        scope.require.defined(artifact);
        scope.assert(defineCompositeAssertion({
            name: 'matches attachments to their original attempts',
            assert(check) {
                return check.group([
                    check.true(attachmentMatchesAttempt(artifact, work, { index: 1 })),
                    check.false(attachmentMatchesAttempt(artifact, work, { index: 0 })),
                    check.false(
                        attachmentMatchesAttempt(artifact, { ...work, case: { ...work.case, title: 'other' } }, {
                            index: 1
                        })
                    )
                ]);
            }
        }));
        const result = resultWithRuntimeAttachments(runResultFactory.build({ artifacts: [ artifact ] }), [ artifact ], {
            localErrors: [],
            owners: [ { kind: 'run' }, { kind: 'case', work, attempt: { index: 1 } } ],
            policy: 'all',
            retainsBranch: retainEveryBranch
        });
        scope.assert(defineCompositeAssertion({
            name: 'deduplicates owned evidence and reports unclaimed owners',
            assert(check) {
                return check.group([
                    check.equal(result.artifacts.length, 1),
                    check.equal(result.runnerErrors.length, 2)
                ]);
            }
        }));

        return scope.assert.collect();
    });
});

const assertConflictAttempts = defineCompositeAssertion({
    name: 'conflict attempts',
    assert(check, artifact: RunArtifact | undefined) {
        if (artifact === undefined) {
            return check.defined(artifact);
        }

        if (artifact.payload.kind !== 'hedged-conflict') {
            throw new Error('Expected conflict evidence.');
        }
        return check.deepEqual(
            [ artifact.payload.authoritative, artifact.payload.conflicting ].map(function retainedAttempts(evidence) {
                return evidence.attachments.map(function retainedAttempt(attachment) {
                    return attachment.id.attempt?.index;
                });
            }),
            [ [ 1, 2 ], [ 1, 2 ] ]
        );
    }
});

type RetryEvidence = { readonly store: AttachmentFixture['store']; readonly first: RuntimeAttachmentArtifact; };
async function capturedRetryEvidence(): Promise<RetryEvidence> {
    const { execution, store } = inlineAttachmentFixture(defaultAttachmentLimits, [ work ]);
    for (const index of [ 0, 1, 2 ]) {
        await execution.runAttempt(work, { index }, async function writeRetryEvidence() {
            const writer = await execution.context.forProducer({ kind: 'case' }).open({
                ...metadata,
                kind: 'text'
            });
            await writer.write(`attempt ${index}`);
            await writer.close();
        });
    }
    const first = store.artifacts()[0];
    if (first === undefined) {
        throw new Error('Expected retry evidence.');
    }

    return { store, first };
}

export const testNode = suite('Runtime attachment results', [
    test('console captures do not collide with resource attachment sequences', async function (scope: TestScope) {
        const { execution, store } = inlineAttachmentFixture(defaultAttachmentLimits, [ work ]);
        await execution.context.forProducer({ kind: 'case' }).json(metadata, { ready: true });
        const attachment = store.artifacts()[0];
        scope.require.defined(attachment);
        const output: RunArtifact = {
            id: { ...attachment.id, subtype: 'log-capture' },
            source: 'native',
            payload: {
                capture: 'automatic',
                completeness: 'best-effort',
                kind: 'captured-output',
                capturedAtMicroseconds: 0,
                stream: 'stdout',
                text: 'ready',
                byteLength: 5,
                truncated: false
            }
        };
        const result = resultWithRuntimeAttachments(
            runResultFactory.build({ artifacts: [ output ] }),
            store.artifacts(),
            {
                localErrors: [],
                owners: [],
                policy: 'all',
                retainsBranch: retainEveryBranch
            }
        );
        scope.assert(
            defineCompositeAssertion({
                name: 'console captures do not collide with resource attachment sequences',
                assert(check) {
                    return check.group([
                        check.equal(result.artifacts.length, 2),
                        check.deepEqual(attachmentArtifacts(result.artifacts), store.artifacts())
                    ]);
                }
            })
        );

        return scope.assert.collect();
    }),
    assertResultOwnership(
        'result merging matches attempt identities, deduplicates artifacts, and reports abandoned owners'
    ),
    test('discarded branch attachment errors do not fail retained execution', function (scope: TestScope) {
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
        scope.assert(
            defineCompositeAssertion({
                name: 'discarded branch attachment errors do not fail retained execution',
                assert(check) {
                    return check.group([
                        check.equal(retained.status, 'passed'),
                        check.deepEqual(retained.runnerErrors, [])
                    ]);
                }
            })
        );

        return scope.assert.collect();
    }),
    test('hedged conflict evidence applies retry retention to both executions', async function (scope) {
        const { store, first } = await capturedRetryEvidence();
        const evidence: HedgedConflictArtifact['payload']['authoritative'] = {
            attachments: store.artifacts(),
            outcome: { kind: 'pass' },
            verdict: 'pass',
            attempts: [
                {
                    property: null,
                    benchmark: null,
                    attempt: { index: 0 },
                    durationMicroseconds: 0,
                    outcome: null,
                    verdict: 'fail'
                },
                {
                    property: null,
                    benchmark: null,
                    attempt: { index: 1 },
                    durationMicroseconds: 0,
                    outcome: null,
                    verdict: 'fail'
                },
                {
                    property: null,
                    benchmark: null,
                    attempt: { index: 2 },
                    durationMicroseconds: 0,
                    outcome: { kind: 'pass' },
                    verdict: 'pass'
                }
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
        scope.assert(assertConflictAttempts, result.artifacts[0]);

        return scope.assert.collect();
    })
]);
