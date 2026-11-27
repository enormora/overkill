import { suite, test } from '@overkill-dev/test';

import { createDeterministicClock, type DeterministicClock } from '@enormora/clock';

import { placementPlan, fakeWorkerRuntime } from '../test-support/worker-pool-placement-validation-fixture.ts';
import { createDynamicDispatcher } from './worker-pool-dynamic-dispatcher.ts';
import type { PlacementPlan, PlacementLane } from './run-types.ts';
import type { WorkerPoolRunRuntime } from './worker-pool-runtime.ts';
import type { WorkerPoolWorkDispatcher } from './worker-pool-dispatch-state.ts';

type DispatchFixture = {
    readonly clock: DeterministicClock;
    readonly dispatcher: WorkerPoolWorkDispatcher;
    readonly lane: PlacementLane;
    readonly cancellations: () => number;
};
function dispatchPlan(faultDomains: readonly string[]): PlacementPlan {
    const original = placementPlan();
    const unit = original.units[0];
    const lane = original.lanes[0];
    if (unit === undefined || lane === undefined) {
        throw new Error('Expected placement fixture.');
    }
    const primary = {
        ...unit,
        scheduling: 'concurrent' as const,
        resourceConstraints: {
            ...unit.resourceConstraints,
            duplicateExecution: [ 'idempotent' ] as const,
            faultDomains
        }
    };
    const filler = {
        ...unit,
        id: { ...unit.id, key: 'filler' },
        resourceConstraints: {
            ...unit.resourceConstraints,
            affinityKeys: [ 'filler' ]
        },
        work: [ { ...unit.work[0], case: { ...unit.work[0].case, title: 'filler' } } ] as const
    };
    const spare = { ...lane, id: 'worker-2', executor: { ...lane.executor, id: 'worker-2' } };
    return {
        units: [ primary, filler ],
        lanes: [ lane, spare ],
        resourceOwnership: { owners: [] },
        assignments: [ { lane: lane.id, unit: primary.id }, { lane: spare.id, unit: filler.id } ]
    };
}
function hedgedRuntime(plan: PlacementPlan, clock: DeterministicClock, cancelled: () => void): WorkerPoolRunRuntime {
    const original = fakeWorkerRuntime(plan);
    const { execution } = original.resolvedRun.facts;
    if (execution.processModel !== 'worker-pool') {
        throw new Error('Expected worker-pool execution.');
    }
    return {
        ...original,
        dependencies: {
            ...original.dependencies,
            wallClock: {
                ...clock,
                get currentDate() {
                    return clock.currentDate;
                },
                get currentUnixEpochMilliseconds() {
                    return clock.currentUnixEpochMilliseconds;
                },
                get currentUnixEpochMicroseconds() {
                    return clock.currentUnixEpochMicroseconds;
                },
                get currentMonotonicMicroseconds() {
                    return clock.currentMonotonicMicroseconds;
                },
                clearTimeout(timeout) {
                    cancelled();
                    clock.clearTimeout(timeout);
                }
            }
        },
        resolvedRun: {
            ...original.resolvedRun,
            facts: {
                ...original.resolvedRun.facts,
                execution: {
                    ...execution,
                    hedging: { mode: 'on', durationMultiplier: 1, minimumDelayMilliseconds: 50 }
                }
            }
        }
    };
}
function idleHedgeLane(dispatcher: WorkerPoolWorkDispatcher, plan: PlacementPlan): PlacementLane {
    const primary = plan.lanes[0];
    const lane = plan.lanes[1];
    if (primary === undefined || lane === undefined) {
        throw new Error('Expected two lanes.');
    }
    dispatcher.pull(primary);
    const filler = dispatcher.pull(lane);
    if (filler === null) {
        throw new Error('Expected filler lease.');
    }
    dispatcher.finish(filler, { learnWarmth: false, retainReservation: false, workerCrashed: false });
    return lane;
}
function dispatchFixture(faultDomains: readonly string[]): DispatchFixture {
    const plan = dispatchPlan(faultDomains);
    const clock = createDeterministicClock({ initialUnixEpochMicroseconds: 0n });
    let cancellations = 0;
    const runtime = hedgedRuntime(plan, clock, function () {
        cancellations += 1;
    });
    const dispatcher = createDynamicDispatcher(runtime, plan);
    const lane = idleHedgeLane(dispatcher, plan);
    return {
        clock,
        dispatcher,
        lane,
        cancellations() {
            return cancellations;
        }
    };
}
type DispatchWake = { readonly completed: Promise<void>; readonly notified: () => boolean; };
function observeDispatchWake(dispatcher: WorkerPoolWorkDispatcher): DispatchWake {
    let notified = false;
    async function observe(): Promise<void> {
        await dispatcher.waitForChange();
        notified = true;
    }
    const completed = observe();
    return {
        completed,
        notified() {
            return notified;
        }
    };
}
export const testNode = suite('dynamic dispatch hedge timing', [
    test('wakes an idle lane when its hedge delay expires', async function (scope) {
        const { clock, dispatcher, lane } = dispatchFixture([]);
        const wake = observeDispatchWake(dispatcher);
        scope.assert.deepEqual([ dispatcher.blocked(lane), dispatcher.blocked(lane) ], [ true, true ]);
        clock.advanceByMilliseconds(49);
        await Promise.resolve();
        scope.assert.false(wake.notified());
        clock.advanceByMilliseconds(1);
        await wake.completed;
        scope.assert.equal(dispatcher.pull(lane)?.kind, 'hedged-duplicate');
        return scope.assert.collect();
    }),
    test('cancels a scheduled hedge wake when the queue is cleared', async function (scope) {
        const fixture = dispatchFixture([]);
        scope.assert.true(fixture.dispatcher.blocked(fixture.lane));
        const wake = fixture.dispatcher.waitForChange();
        fixture.dispatcher.clear();
        await wake;
        fixture.dispatcher.clear();
        fixture.clock.advanceByMilliseconds(100);
        scope.assert.equal(fixture.cancellations(), 1);
        return scope.assert.collect();
    }),
    test('does not hedge onto a lane without fault-domain capacity', function (scope) {
        const { dispatcher, lane } = dispatchFixture([ 'rack' ]);
        scope.assert.false(dispatcher.blocked(lane));
        scope.assert.equal(dispatcher.pull(lane), null);
        dispatcher.clear();
        return scope.assert.collect();
    })
]);
