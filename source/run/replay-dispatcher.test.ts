import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { placementPlan, fakeWorkerRuntime } from './worker-pool-placement-validation.test.ts';
import { createTaskRun } from './worker-pool-execution-state.test.ts';
import { createPlacementTraceRecorder, type PlacementTrace } from './placement-trace.ts';
import type { WorkerPoolRunRuntime, WorkerPoolTaskRun } from './worker-pool-runtime.ts';
import type { WorkerPoolWorkDispatcher } from './worker-pool-dispatch-state.ts';
import type { PlacementPlan, PlacementLane } from './run-types.ts';
import { createReplayDispatcher } from './replay-dispatcher.ts';

function hedgePlan(): PlacementPlan {
    const plan = placementPlan();
    const lane = plan.lanes[0];
    if (lane === undefined) {
        throw new Error('Expected fixture lane.');
    }
    return {
        ...plan,
        units: plan.units.map(function idempotent(unit) {
            return {
                ...unit,
                resourceConstraints: { ...unit.resourceConstraints, duplicateExecution: [ 'idempotent' ] as const }
            };
        }),
        lanes: [ lane, { ...lane, id: 'worker-2', executor: { ...lane.executor, id: 'worker-2' } } ]
    };
}
function requiredUnit(plan: PlacementPlan): PlacementPlan['units'][number] {
    const unit = plan.units[0];
    if (unit === undefined) {
        throw new Error('Expected fixture work.');
    }
    return unit;
}
function cancelledTrace(plan: PlacementPlan): PlacementTrace {
    const unit = requiredUnit(plan);
    const trace = createPlacementTraceRecorder();
    const primary = trace.assignAttempt(unit.id, unit.work, 'worker-1', { kind: 'initial' });
    const duplicate = trace.assignAttempt(unit.id, unit.work, 'worker-2', { kind: 'hedge', primaryAttempt: primary });
    trace.startAttempt(primary, '1:1');
    trace.completeAttempt(primary, 1);
    trace.interruptAttempt(duplicate, 'hedge-cancelled');
    trace.decideRecovery(duplicate, 'hedge-cancelled', { kind: 'abandon', abandonedWork: unit.work });
    return trace.finish();
}
type CancellationFixture = {
    readonly runtime: WorkerPoolRunRuntime;
    readonly dispatcher: WorkerPoolWorkDispatcher;
    readonly primaryLane: PlacementLane;
    readonly duplicateLane: PlacementLane;
};
function assertCancelledTask(scope: TestScope, task: WorkerPoolTaskRun, blocked: () => boolean): void {
    scope.assert.true(blocked());
    scope.assert.true(task.controller.signal.aborted);
    scope.assert.false(task.includeArtifacts.read());
    scope.assert.false(task.requeuePendingCases.read());
    scope.assert.equal(task.interruptionCause.read(), 'hedge-cancelled');
}
function cancellationFixture(): CancellationFixture {
    const plan = hedgePlan();
    const runtime = fakeWorkerRuntime(plan);
    const dispatcher = createReplayDispatcher(runtime, plan, {
        status: 'completed',
        placementTrace: cancelledTrace(plan)
    });
    const primaryLane = plan.lanes[0];
    const duplicateLane = plan.lanes[1];
    if (primaryLane === undefined || duplicateLane === undefined) {
        throw new Error('Expected fixture lanes.');
    }
    return { runtime, dispatcher, primaryLane, duplicateLane };
}
function assertDuplicateCancellation(scope: TestScope): void {
    const { runtime, dispatcher, primaryLane, duplicateLane } = cancellationFixture();
    const primary = dispatcher.pull(primaryLane);
    const duplicate = dispatcher.pull(duplicateLane);
    scope.require.defined(primary);
    scope.require.defined(duplicate);
    const task = { ...createTaskRun(runtime.runState), members: duplicate.members };
    runtime.activeTasks.add(task);
    dispatcher.finish(primary, { learnWarmth: false, workerCrashed: false, retainReservation: false });
    scope.assert.true(dispatcher.blocked(primaryLane));
    assertCancelledTask(scope, task, function blocked() {
        return dispatcher.blocked(primaryLane);
    });
}
export const testNode = suite('replay dispatcher lifecycle', [
    test('cancels the recorded duplicate after its authority completes', function (scope: TestScope) {
        assertDuplicateCancellation(scope);
        return scope.assert.collect();
    }),
    test('refuses an assignment on the wrong lane', function (scope: TestScope) {
        const { dispatcher, duplicateLane, primaryLane } = cancellationFixture();
        scope.assert.equal(dispatcher.pull(duplicateLane), null);
        scope.assert.true(dispatcher.blocked(duplicateLane));
        scope.require.defined(dispatcher.pull(primaryLane));
        scope.assert.equal(dispatcher.pull(duplicateLane)?.kind, 'hedged-duplicate');
        return scope.assert.collect();
    }),
    test('clear wakes waiters and prevents further dispatch', async function (scope: TestScope) {
        const { dispatcher, primaryLane } = cancellationFixture();
        const notified = dispatcher.waitForChange();
        dispatcher.clear();
        await notified;
        scope.assert.equal(dispatcher.pull(primaryLane), null);
        scope.assert.false(dispatcher.blocked(primaryLane));
        return scope.assert.collect();
    }),
    test('requeue wakes waiters without changing recorded assignment order', async function (scope: TestScope) {
        const { dispatcher, primaryLane, duplicateLane } = cancellationFixture();
        const primary = dispatcher.pull(primaryLane);
        scope.require.defined(primary);
        const notified = dispatcher.waitForChange();
        dispatcher.requeue({
            previousAttempt: primary.members[0].attempt,
            traceUnit: primary.traceUnit,
            unit: primary.unit
        });
        await notified;
        scope.assert.equal(dispatcher.pull(duplicateLane)?.members[0].attempt, 'attempt-2');
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);
