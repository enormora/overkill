import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import { withRecordedWorkerTrace } from '../test-support/replay-record-fixture.ts';
import type { RunResult } from '../engine/run-result.ts';
import { createCollectedPlan, createTaskRun, fakeWorkerRuntime } from './worker-pool-execution-state.test.ts';
import type { WorkerPoolRunRuntime, WorkerPoolTaskRun } from './worker-pool-runtime.ts';
import type { PlacementTrace } from './placement-trace.ts';
import {
    recordedHedgeAuthority,
    deferReplayHedge,
    isDeferredReplayTask,
    pendingReplayHedges,
    releaseReplayHedge,
    replayPlacementResult
} from './replay-hedging.ts';
import { recordCompletedHedgedTaskRun, type HedgedAuthorities } from './worker-pool-hedged-arbitration.ts';

type Entries = PlacementTrace['entries'];
type Fixture = {
    readonly runtime: WorkerPoolRunRuntime;
    readonly primary: WorkerPoolTaskRun;
    readonly duplicate: WorkerPoolTaskRun;
};
function assignedTask(
    runtime: WorkerPoolRunRuntime,
    lane: string,
    reason: Parameters<WorkerPoolRunRuntime['placementTrace']['assignAttempt']>[3]
): WorkerPoolTaskRun {
    const task = createTaskRun(runtime.runState);
    const member = task.members[0];
    const attempt = runtime.placementTrace.assignAttempt(member.traceUnit, member.unit.work, lane, reason);
    return { ...task, lane, reporterEventsBuffered: true, members: [ { ...member, attempt } ] };
}
function hedgeFixture(): Fixture {
    const runtime = fakeWorkerRuntime(createCollectedPlan());
    const primary = assignedTask(runtime, 'worker-1', { kind: 'initial' });
    const duplicate = assignedTask(runtime, 'worker-2', { kind: 'hedge', primaryAttempt: primary.members[0].attempt });
    return { runtime, primary, duplicate };
}
function taskResult(task: WorkerPoolTaskRun, passed: boolean): RunResult {
    const work = task.unit.work[0];
    return runResultFactory.build({
        perTest: [ {
            id: work.case,
            workId: work,
            verdict: passed ? 'pass' : 'fail',
            outcome: passed
                ? { kind: 'pass' }
                : {
                    kind: 'fail',
                    failures: [ {
                        kind: 'body-error',
                        error: { name: 'Error', message: 'failed', stack: null, thrown: null }
                    } ]
                }
        } ]
    });
}
function sourceDecisions(fixture: Fixture): Entries {
    return [ ...fixture.runtime.placementTrace.entries(), {
        kind: 'hedge-resolved',
        authoritativeAttempt: fixture.primary.members[0].attempt,
        discardedAttempt: fixture.duplicate.members[0].attempt,
        outcome: 'matched'
    } ];
}
async function withSource<Value>(fixture: Fixture, entries: Entries, execute: () => Promise<Value>): Promise<Value> {
    return await withRecordedWorkerTrace(fixture.runtime, { entries }, execute);
}
async function assertAuthority(scope: TestScope, matching: boolean): Promise<void> {
    const fixture = hedgeFixture();
    const authorities: HedgedAuthorities = new Map();
    fixture.runtime.activeTasks.add(fixture.primary);
    await withSource(fixture, sourceDecisions(fixture), async function reversedCompletions() {
        await recordCompletedHedgedTaskRun(
            authorities,
            taskResult(fixture.duplicate, matching),
            fixture.duplicate,
            fixture.runtime
        );
        scope.assert.equal(
            fixture
                .runtime
                .taskResults
                .flatMap(function (result) {
                    return result.perTest;
                })
                .length,
            0
        );
        scope.assert.true(isDeferredReplayTask(fixture.duplicate));
        await recordCompletedHedgedTaskRun(
            authorities,
            taskResult(fixture.primary, true),
            fixture.primary,
            fixture.runtime
        );
        scope.assert.equal(pendingReplayHedges(fixture.runtime, fixture.primary).length, 0);
    });
    const results = fixture.runtime.taskResults.flatMap(function (result) {
        return result.perTest;
    });
    scope.assert.equal(results.length, 1);
    scope.assert.equal(results.at(-1)?.verdict, matching ? 'pass' : 'fail');
    scope.assert.equal(fixture.runtime.runState.artifacts().length, matching ? 0 : 1);
}
export const testNode = suite('recorded hedge result authority', [
    test(
        'keeps results without inventing an authority when the source has no trace',
        async function (scope: TestScope) {
            const fixture = hedgeFixture();
            const result = taskResult(fixture.primary, true);
            await withRecordedWorkerTrace(fixture.runtime, null, async function untracedSource() {
                scope.assert.equal(recordedHedgeAuthority(fixture.primary), null);
                scope.assert.false(deferReplayHedge(fixture.runtime, { taskRun: fixture.primary, result }));
                scope.assert.deepEqual(replayPlacementResult(result, fixture.primary.members), result);
            });
            return scope.assert.collect();
        }
    ),
    ...[ true, false ].map(function duplicateOutcome(matching) {
        return test(
            matching
                ? 'retains saved authority when its duplicate finishes first'
                : 'retains conflicts from an earlier duplicate',
            async function (scope: TestScope) {
                await assertAuthority(scope, matching);
                return scope.assert.collect();
            }
        );
    }),
    test('falls back to the recorded completion and assignment order', async function (scope: TestScope) {
        const fixture = hedgeFixture();
        const entries = Array.from(fixture.runtime.placementTrace.entries());
        await withSource(fixture, entries, async function assignmentFallback() {
            scope.assert.equal(recordedHedgeAuthority(fixture.duplicate), fixture.primary.members[0].attempt);
            scope.assert.false(
                deferReplayHedge(fixture.runtime, {
                    taskRun: fixture.primary,
                    result: taskResult(fixture.primary, true)
                })
            );
        });
        await withSource(fixture, [ ...entries, {
            kind: 'attempt-completed',
            attempt: fixture.duplicate.members[0].attempt,
            durationMicroseconds: 1
        } ], async function completionFallback() {
            scope.assert.equal(recordedHedgeAuthority(fixture.primary), fixture.duplicate.members[0].attempt);
        });
        return scope.assert.collect();
    }),
    test('releases deferred duplicates without affecting unrelated work', async function (scope: TestScope) {
        const fixture = hedgeFixture();
        const completion = { taskRun: fixture.duplicate, result: taskResult(fixture.duplicate, true) };
        await withSource(fixture, sourceDecisions(fixture), async function pendingDuplicate() {
            scope.assert.true(deferReplayHedge(fixture.runtime, completion));
            scope.assert.deepEqual(pendingReplayHedges(fixture.runtime, fixture.primary), [ completion ]);
            releaseReplayHedge(fixture.runtime, completion);
            scope.assert.deepEqual(pendingReplayHedges(fixture.runtime, fixture.primary), []);
        });
        return scope.assert.collect();
    }),
    test('drops superseded recovery results and keeps the final assignment', async function (scope: TestScope) {
        const fixture = hedgeFixture();
        const initial = fixture.runtime.placementTrace.entries()[0];
        scope.require.defined(initial);
        await withSource(fixture, [ initial, {
            kind: 'attempt-assigned',
            attempt: fixture.duplicate.members[0].attempt,
            lane: 'worker-2',
            unit: fixture.primary.traceUnit,
            work: fixture.primary.unit.work,
            reason: { kind: 'recovery', previousAttempt: fixture.primary.members[0].attempt }
        } ], async function recoveredResult() {
            scope.assert.equal(
                replayPlacementResult(taskResult(fixture.primary, true), fixture.primary.members).perTest.length,
                0
            );
            scope.assert.equal(
                replayPlacementResult(taskResult(fixture.duplicate, true), fixture.duplicate.members).perTest.length,
                1
            );
        });
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);
