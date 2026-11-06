import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import type { PlacementPlan, PlacementLane } from './run-types.ts';
import type { WorkerPoolWorkDispatcher } from './worker-pool-dispatch-state.ts';
import { placementPlan, fakeWorkerRuntime } from './worker-pool-placement-validation.test.ts';
import { createPlacementTraceRecorder, type PlacementTrace } from './placement-trace.ts';
import { compileReplayTrace } from './replay-trace-plan.ts';
import { createReplayDispatcher } from './replay-dispatcher.ts';
import { validateReplayPlacement } from './replay-placement-validation.ts';

function completedTrace(
    plan: PlacementPlan
): PlacementTrace {
    const unit = plan.units[0];
    const lane = plan.lanes[0];
    if (unit === undefined || lane === undefined) {
        throw new Error('Expected fixture work.');
    }
    const trace = createPlacementTraceRecorder();
    const attempt = trace.assignAttempt(unit.id, unit.work, lane.id, { kind: 'initial' });
    trace.startAttempt(attempt, '1:1');
    trace.completeAttempt(attempt, 100);
    return trace.finish();
}
type DispatchFixture = {
    readonly dispatcher: WorkerPoolWorkDispatcher;
    readonly lane: PlacementLane;
    readonly work: PlacementPlan['units'][number]['work'];
};
function recordedDispatcher(): DispatchFixture {
    const plan = placementPlan();
    const lane = plan.lanes[0];
    const unit = plan.units[0];
    if (lane === undefined || unit === undefined) {
        throw new Error('Expected fixture placement.');
    }
    return {
        dispatcher: createReplayDispatcher(fakeWorkerRuntime(plan), plan, {
            status: 'completed',
            placementTrace: completedTrace(plan)
        }),
        lane,
        work: unit.work
    };
}
export const testNode = suite('recorded scheduling replay', [
    test('dispatches the recorded lane and waits for actual completion', function (scope: TestScope) {
        const { dispatcher, lane, work } = recordedDispatcher();
        const lease = dispatcher.pull(lane);
        scope.require.defined(lease);
        scope.assert.deepEqual(lease.unit.work, work);
        scope.assert.true(dispatcher.blocked(lane));
        dispatcher.finish(lease, { learnWarmth: false, workerCrashed: false, retainReservation: false });
        scope.assert.false(dispatcher.blocked(lane));
        return scope.assert.collect();
    }),
    test('continues an interrupted prefix in saved lane order', function (scope: TestScope) {
        const plan = placementPlan();
        const trace = compileReplayTrace(plan, { status: 'interrupted', placementTrace: { entries: [] } });
        scope.assert.deepEqual(
            trace.entries.map(function assigned(entry) {
                return entry.kind;
            }),
            [ 'attempt-assigned' ]
        );
        scope.assert.deepEqual(
            Array.from(trace.assignments.values(), function work(entry) {
                return entry.work;
            }),
            plan.units.map(function work(unit) {
                return unit.work;
            })
        );
        scope.assert.equal(trace.assignments.get('attempt-1')?.lane, plan.assignments[0]?.lane);
        return scope.assert.collect();
    }),
    test('rejects unknown trace attempts and placement references', function (scope: TestScope) {
        const plan = placementPlan();
        scope.assert.throws(function unknownAttempt() {
            compileReplayTrace(plan, {
                status: 'completed',
                placementTrace: {
                    entries: [
                        { kind: 'attempt-completed', attempt: 'attempt-99', durationMicroseconds: 1 }
                    ]
                }
            });
        }, { message: /not started/u });
        scope.assert.throws(function missingAssignment() {
            validateReplayPlacement(
                { ...plan, assignments: [] },
                plan.units.flatMap(function work(unit) {
                    return unit.work;
                })
            );
        }, { message: /missing or unknown/u });
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);
