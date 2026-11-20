import { type TestScope, suite as authoredSuite, test } from '@overkill-dev/test';

import { createDeterministicClock } from '@enormora/clock';

import { createCollectedPlan, fakeWorkerRuntime, createTaskRun } from '../test-support/worker-pool-execution-state.ts';
import { debugArtifactFixture } from '../test-support/debug-artifact-fixture.ts';
import { attachmentCoordinationForWork } from '../test-support/attachment-coordination.ts';
import { exchangedAttachment } from '../test-support/attachment-exchange.ts';
import type { WorkId, RuntimeAttachmentArtifact } from '../packages/engine/engine.entry-point.ts';
import { createRunTimingMeasurement } from './run-timing-collection.ts';
import type { WorkerPoolRunRuntime, WorkerPoolTaskRun } from './worker-pool-runtime.ts';
import { handleWorkerMessage } from './worker-pool-task-events.ts';

type AttachmentFixture = {
    readonly task: WorkerPoolTaskRun;
    readonly work: WorkId;
    readonly attachment: RuntimeAttachmentArtifact;
    readonly runtime: WorkerPoolRunRuntime;
};

function attachmentFixture(scope: TestScope): AttachmentFixture {
    const source = fakeWorkerRuntime(createCollectedPlan());
    const task = { ...createTaskRun(source.runState), reporterEventsBuffered: true };
    const work = task.members[0].unit.work[0];
    const attachment = {
        ...exchangedAttachment,
        id: {
            ...exchangedAttachment.id,
            scope: {
                kind: 'case' as const,
                case: work.case,
                activeCases: [ work.case ],
                confidence: 'active-case' as const
            },
            attempt: { index: 0 },
            familyVariant: work.familyVariant,
            runtimes: work.runtimes,
            workload: work.workload
        }
    };
    const attachments = attachmentCoordinationForWork(null, [ work ]);
    scope.cleanup(attachments.coordinator.close);
    const runtime = { ...source, attachments: attachments.coordinator };
    return { task, work, attachment, runtime };
}

export const testNode = authoredSuite('worker event evidence ownership', [
    test('records local worker timing observations', function (scope: TestScope) {
        const source = fakeWorkerRuntime(createCollectedPlan());
        const timing = createRunTimingMeasurement(createDeterministicClock({ initialUnixEpochMicroseconds: 0n }));
        const runtime = { ...source, timing };
        const task = createTaskRun(runtime.runState);
        const span = {
            durationMicroseconds: 42,
            kind: 'worker.ready',
            label: null,
            processId: '1',
            resource: null,
            startOffsetMicroseconds: 0,
            startTimeUnixMicroseconds: 0,
            status: 'success',
            workerId: '1:1'
        } as const;
        handleWorkerMessage({ kind: 'timing', span }, task, runtime);
        scope.assert.deepEqual(timing.report().spans, [ { ...span, startOffsetMicroseconds: null } ]);
        return scope.assert.collect();
    }),
    test('preserves foreign debug checkpoint identities', async function (scope: TestScope) {
        const runtime = fakeWorkerRuntime(createCollectedPlan());
        const task = { ...createTaskRun(runtime.runState), reporterEventsBuffered: true };
        const { artifact } = await debugArtifactFixture('foreign');
        const checkpoint = {
            ...artifact,
            source: 'boundary-captured' as const,
            id: { ...artifact.id, sequence: 99 },
            payload: { ...artifact.payload, completeness: 'incomplete' as const }
        };
        handleWorkerMessage(
            { kind: 'event', event: { kind: 'debug-checkpoint', artifact: checkpoint } },
            task,
            runtime
        );
        scope.assert.equal(task.state.artifacts()[0]?.id.sequence, 99);
        return scope.assert.collect();
    }),
    test('settles attachment ownership while retaining ordinary case evidence', function (scope: TestScope) {
        const { task, work, attachment, runtime } = attachmentFixture(scope);
        handleWorkerMessage(
            {
                kind: 'event',
                event: {
                    kind: 'test-start',
                    case: work.case,
                    workId: work,
                    attempt: 0,
                    definitionLocations: [ { kind: 'unknown' } ],
                    suitePath: []
                }
            },
            task,
            runtime
        );
        handleWorkerMessage(
            {
                kind: 'event',
                event: {
                    kind: 'test-end',
                    case: work.case,
                    workId: work,
                    attempt: 0,
                    definitionLocations: [ { kind: 'unknown' } ],
                    suitePath: [],
                    artifacts: [ attachment ],
                    outcome: { kind: 'pass' },
                    verdict: 'pass',
                    durationMicroseconds: 0,
                    completion: 'final',
                    property: null,
                    benchmark: null
                }
            },
            task,
            runtime
        );
        const event = Array.from(task.bufferedReporterEvents).find(function (candidate) {
            return candidate.kind === 'test-end';
        });
        scope.assert.deepEqual<unknown, unknown>({ artifacts: event?.artifacts }, {
            artifacts: [ attachment ]
        });
        return scope.assert.collect();
    })
]);
