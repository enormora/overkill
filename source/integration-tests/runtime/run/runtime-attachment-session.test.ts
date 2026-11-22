import { suite, test, type TestScope } from '@overkill-dev/test';
import { assertFinalReporter, completedAttachmentRecord } from '../../../test-support/attachment-session-assertions.ts';

import { attachmentRunFixture, localAttachmentRunFixture } from '../../../test-support/attachment-run-fixture.ts';
import { runResultFactory } from '../../../test-support/run-result-factory.ts';
import { attachmentsForProducer } from '../../../attachments/attachment-context.ts';
import { executeWithAttachments } from '../../../run/attachment-run.ts';
import { executeWithRuntimeAttachments } from '../../../run/runtime-attachment-boundary.ts';
import { runWithWorkerAttachments } from '../../../run/attachment-worker-context.ts';

export const testNode = suite('Runtime attachment session', [
    test('completed records contain retained lifecycle attachments', async function (scope: TestScope) {
        const { resolved, dependencies, writes } = await localAttachmentRunFixture(scope.cleanup);
        const result = await executeWithRuntimeAttachments(
            resolved,
            dependencies,
            async function captureCompletedEvidence() {
                scope.assert(assertFinalReporter);
                await attachmentsForProducer({ kind: 'resource', name: 'service' }).json(
                    { name: 'setup', mediaType: 'application/json' },
                    { ready: true }
                );
                return runResultFactory.build({ summary: { passed: 1, planned: 1, discovered: 1, defined: 1 } });
            },
            null
        );
        scope.assert.equal(result.status, 'passed');
        scope.assert.equal(result.artifacts.length, 1);
        const record = Array.from(writes.values()).at(-1);
        scope.assert(completedAttachmentRecord, record);

        return scope.assert.collect();
    }),
    test('empty selections and unmanaged workers avoid attachment sessions', async function (scope) {
        const { resolved, dependencies, writes } = await attachmentRunFixture(scope.cleanup);
        const empty = { ...resolved, facts: { ...resolved.facts, cases: [] } };
        const expected = runResultFactory.build();
        const result = await executeWithAttachments(empty, dependencies, async function runEmptySelection() {
            return expected;
        }, null);
        scope.assert.equal(result, expected);
        scope.assert.equal(writes.size, 0);
        const native = await runWithWorkerAttachments(null, null, async function runWithoutTransport() {
            return 42;
        });
        scope.assert.equal(native, 42);

        return scope.assert.collect();
    })
]);
