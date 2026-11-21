import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { suite, test, type TestScope } from '@overkill-dev/test';

import { z } from 'zod/v4';

import { defaultFailureArtifactPolicy, defineReporter } from '../../../packages/engine/engine.entry-point.ts';

import { attachmentRunFixture, localAttachmentRunFixture } from '../../../test-support/attachment-run-fixture.ts';
import { runResultFactory } from '../../../test-support/run-result-factory.ts';
import { attachmentsForProducer } from '../../../attachments/attachment-context.ts';
import { executeWithAttachments } from '../../../run/attachment-run.ts';
import { executeWithRuntimeAttachments } from '../../../run/runtime-attachment-boundary.ts';
import { runWithWorkerAttachments } from '../../../run/attachment-worker-context.ts';
import { reporterWithAttachments } from '../../../run/attachment-reporter.ts';

const completedRecord = z.object({
    status: z.literal('completed'),
    result: z.object({
        artifacts: z.array(z.object({
            payload: z.object({ content: z.object({ value: z.object({ ready: z.literal(true) }) }) })
        }))
    })
});

const assertFinalReporter = defineCompositeAssertion({
    name: 'final reporter',
    assert(check) {
        const reporter = {
            dispose: null,
            kind: 'final-result',
            name: 'final',
            sinks: [],
            async onResult() {
                return undefined;
            }
        } as const;
        const wrapped = reporterWithAttachments(defineReporter(function finalReporter() {
            return reporter;
        }));
        return check.group([ check.equal(
            wrapped({
                failureArtifacts: defaultFailureArtifactPolicy,
                relativizeLocationPath(location) {
                    return location.file;
                }
            }),
            reporter
        ) ]);
    }
});

export const testNode = suite('Runtime attachment session', [
    test('completed records contain retained lifecycle attachments', async (scope: TestScope) => {
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
        scope.require.defined(record);
        const persisted = completedRecord.parse(JSON.parse(record));
        scope.assert.equal(persisted.result.artifacts.length, 1);

        return scope.assert.collect();
    }),
    test('empty selections and unmanaged workers avoid attachment sessions', async (scope) => {
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
