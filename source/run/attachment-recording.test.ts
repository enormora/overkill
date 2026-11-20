import { type TestScope, suite as authoredSuite, test } from '@overkill-dev/test';

import { attachmentRecording } from '../test-support/attachment-recording.ts';
import { exchangedAttachment } from '../test-support/attachment-exchange.ts';
import { memoryHistoryAccess, idleHistoryScenario } from '../test-support/history-access.ts';
import { createAttachmentRecord } from './attachment-record.ts';
import { collectedRunPlanFromTestPlan } from './collected-run-plan.ts';
import { inspectDetailedRecordState } from './history-state-access.ts';
import { historyRecordSchema } from './history-record.ts';

export const testNode = authoredSuite('attachment run recording', [
    test('classifies persisted attachment records by their replay completeness', async function (scope: TestScope) {
        const fixture = await attachmentRecording(null);
        const record = await createAttachmentRecord(fixture.resolved, fixture.dependencies, null);
        await record.checkpoint([ exchangedAttachment ]);
        const content = fixture.writes.get(record.session.path);
        scope.require.defined(content);
        const history = await memoryHistoryAccess(idleHistoryScenario);
        const decoded = historyRecordSchema.parse(JSON.parse(content));
        scope.assert.equal(
            await inspectDetailedRecordState(record.session.path, {
                ...history.runtime,
                async readText() {
                    return content;
                }
            }),
            'available'
        );
        scope.assert.equal(
            await inspectDetailedRecordState(record.session.path, {
                ...history.runtime,
                async readText() {
                    return JSON.stringify({ ...decoded, replayPlan: null });
                }
            }),
            'unavailable'
        );
        return scope.assert.collect();
    }),
    test('uses an existing record session without starting another run', async function (scope: TestScope) {
        const fixture = await attachmentRecording(null);
        const record = await createAttachmentRecord(fixture.resolved, fixture.dependencies, fixture.session);
        scope.assert.equal(record.session, fixture.session);
        scope.assert.deepEqual(fixture.calls, [ 'details', 'facts' ]);
        fixture.clock.advanceByMilliseconds(1);
        scope.assert.equal(record.captureTime(), 1000);
        return scope.assert.collect();
    }),
    test('serializes artifact checkpoints with current capture timings', async function (scope: TestScope) {
        const fixture = await attachmentRecording(null);
        const record = await createAttachmentRecord(fixture.resolved, fixture.dependencies, fixture.session);
        fixture.clock.advanceByMilliseconds(1);
        await Promise.all([ record.checkpoint([]), record.checkpoint([ exchangedAttachment ]) ]);
        scope.assert.equal(fixture.checkpoints.length, 2);
        scope.assert.deepEqual<unknown, unknown>(fixture.checkpoints[1]?.artifacts, [ exchangedAttachment ]);
        scope.assert.equal(fixture.checkpoints[0]?.timings.summary.totalWallTimeMicroseconds, 1000);
        return scope.assert.collect();
    }),
    test('reports persistence failures from artifact checkpoints', async function (scope: TestScope) {
        const fixture = await attachmentRecording(new Error('Checkpoint failed.'));
        const record = await createAttachmentRecord(fixture.resolved, fixture.dependencies, fixture.session);
        await scope.assert.rejects(async function () {
            await record.checkpoint([ exchangedAttachment ]);
        }, { message: 'Checkpoint failed.' });
        return scope.assert.collect();
    }),
    test('records already collected supervised plans without local test bodies', async function (scope: TestScope) {
        const fixture = await attachmentRecording(null);
        const { plan } = fixture.resolved;
        if (plan.kind !== 'local') {
            throw new Error('Expected local plan.');
        }
        const resolved = {
            ...fixture.resolved,
            plan: { kind: 'supervised', collectedPlan: collectedRunPlanFromTestPlan(plan.testPlan) }
        } as const;
        const record = await createAttachmentRecord(resolved, fixture.dependencies, fixture.session);
        await record.checkpoint([]);
        scope.assert.equal(fixture.checkpoints[0]?.summary.planned, plan.testPlan.cases.length);
        return scope.assert.collect();
    }),
    test('creates an on-demand record when attachment retention owns persistence', async function (scope: TestScope) {
        const fixture = await attachmentRecording(null);
        const record = await createAttachmentRecord(fixture.resolved, fixture.dependencies, null);
        await record.checkpoint([ exchangedAttachment ]);
        scope.assert.notEqual(record.session, fixture.session);
        scope.assert.true(fixture.writes.size > 0);
        scope.assert.includes(Array.from(fixture.writes.values()).join(''), 'runtime-attachment');
        return scope.assert.collect();
    })
]);
