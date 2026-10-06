import { z } from 'zod/v4';
import { createSuite, createTestCase, defineReporter, type TestScope } from '../packages/engine/engine.entry-point.ts';
import { attachmentRunFixture, localAttachmentRunFixture } from '../test-support/attachment-run-fixture.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import { attachmentsForProducer } from '../attachments/attachment-context.ts';
import { executeWithAttachments } from './attachment-run.ts';
import { executeWithRuntimeAttachments } from './runtime-attachment-boundary.ts';
import { runWithWorkerAttachments } from './attachment-worker-context.ts';
import { reporterWithAttachments } from './attachment-reporter.ts';

const definition = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;
const completedRecord = z.object({
    status: z.literal('completed'),
    result: z.object({
        artifacts: z.array(z.object({
            payload: z.object({ content: z.object({ value: z.object({ ready: z.literal(true) }) }) })
        }))
    })
});

function assertFinalReporter(scope: TestScope): void {
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
    scope.assert.equal(
        wrapped({
            relativizeLocationPath(location) {
                return location.file;
            }
        }),
        reporter
    );
}
async function assertCompletedRecord(scope: TestScope): Promise<void> {
    const { resolved, dependencies, writes } = await localAttachmentRunFixture(scope);
    const result = await executeWithRuntimeAttachments(
        resolved,
        dependencies,
        async function captureCompletedEvidence() {
            assertFinalReporter(scope);
            await attachmentsForProducer({ kind: 'resource', name: 'service' }).json(
                { name: 'setup', mediaType: 'application/json' },
                { ready: true }
            );
            return runResultFactory.build({ summary: { passed: 1, planned: 1, discovered: 1, defined: 1 } });
        }
    );
    scope.assert.equal(result.status, 'passed');
    scope.assert.equal(result.artifacts.length, 1);
    const record = Array.from(writes.values()).at(-1);
    scope.require.defined(record);
    const persisted = completedRecord.parse(JSON.parse(record));
    scope.assert.equal(persisted.result.artifacts.length, 1);
}

async function assertNoSelectedWork(scope: TestScope): Promise<void> {
    const { resolved, dependencies, writes } = await attachmentRunFixture(scope);
    const empty = { ...resolved, facts: { ...resolved.facts, cases: [] } };
    const expected = runResultFactory.build();
    const result = await executeWithAttachments(empty, dependencies, async function runEmptySelection() {
        return expected;
    });
    scope.assert.equal(result, expected);
    scope.assert.equal(writes.size, 0);
    const native = await runWithWorkerAttachments(null, null, async function runWithoutTransport() {
        return 42;
    });
    scope.assert.equal(native, 42);
}

export const testNode = createSuite({
    ...definition,
    title: 'source/run/runtime-attachment-session.test.ts',
    children: [
        createTestCase({
            ...definition,
            title: 'completed records contain retained lifecycle attachments',
            async body(scope: TestScope) {
                await assertCompletedRecord(scope);
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...definition,
            title: 'empty selections and unmanaged workers avoid attachment sessions',
            async body(scope: TestScope) {
                await assertNoSelectedWork(scope);
                return scope.assert.collect();
            }
        })
    ]
});
const { runIfMain } = await import('../test-support/run-if-main.ts');
await runIfMain(import.meta, testNode);
