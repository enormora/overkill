import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import type { PlacementTraceEntry } from './placement-trace.ts';
import type { PlacementPlan } from './run-types.ts';
import {
    fakeWorkerRuntime,
    placementPlan,
    testCaseMetadata
} from './worker-pool-placement-validation.test.ts';
import type {
    WorkerPoolUnitLease,
    WorkerPoolWorkDispatcher
} from './worker-pool-dispatch-state.ts';
import type { WorkerPoolRunRuntime } from './worker-pool-runtime.ts';
import { createWorkDispatcher } from './worker-pool-work-dispatcher.ts';

type WorkUnit = PlacementPlan['units'][number];
type PlacementLane = PlacementPlan['lanes'][number];
type WarmAffinityTraceEntry = Extract<PlacementTraceEntry, {
    readonly kind: 'warm-lane-affinity-selected';
}>;

function firstLane(plan: PlacementPlan): PlacementLane {
    const lane = plan.lanes[0];

    if (lane === undefined) {
        throw new Error('Worker-pool warm-lane dispatch fixture requires a lane.');
    }

    return lane;
}

function firstUnit(plan: PlacementPlan): WorkUnit {
    const unit = plan.units[0];

    if (unit === undefined) {
        throw new Error('Worker-pool warm-lane dispatch fixture requires a work unit.');
    }

    return unit;
}

function firstWork(unit: WorkUnit): WorkUnit['work'][number] {
    return unit.work[0];
}

function workerLane(id: string): PlacementLane {
    const lane = firstLane(placementPlan());

    return {
        ...lane,
        executor: {
            ...lane.executor,
            id
        },
        id
    };
}

function unitWithFile(
    key: string,
    title: string,
    file: string,
    workerLifecycle: WorkUnit['workerLifecycle']
): WorkUnit {
    const unit = firstUnit(placementPlan());
    const work = firstWork(unit);

    return {
        ...unit,
        id: {
            ...unit.id,
            key
        },
        scheduling: 'concurrent',
        workerLifecycle,
        work: [
            {
                ...work,
                case: {
                    ...work.case,
                    file,
                    title
                }
            }
        ]
    };
}

function warmAffinityPlan(workerLifecycle: WorkUnit['workerLifecycle']): PlacementPlan {
    const first = workerLane('worker-1');
    const second = workerLane('worker-2');
    const warmup = unitWithFile('warmup', 'warmup', 'source/api/create.test.ts', workerLifecycle);
    const cold = unitWithFile('cold', 'cold', 'source/other/read.test.ts', workerLifecycle);
    const warm = unitWithFile('warm', 'warm', 'source/api/update.test.ts', workerLifecycle);

    return {
        assignments: [
            { lane: first.id, unit: warmup.id },
            { lane: second.id, unit: cold.id },
            { lane: first.id, unit: warm.id }
        ],
        lanes: [ first, second ],
        units: [ warmup, cold, warm ]
    };
}

function warmAffinityCrashPlan(): PlacementPlan {
    const first = workerLane('worker-1');
    const second = workerLane('worker-2');
    const warmup = unitWithFile('warmup', 'warmup', 'source/api/create.test.ts', 'reuse');
    const warmCrash = unitWithFile('warm-crash', 'warm-crash', 'source/api/update.test.ts', 'reuse');
    const cold = unitWithFile('cold', 'cold', 'source/other/read.test.ts', 'reuse');
    const warmAfterCrash = unitWithFile('warm-after-crash', 'warm-after-crash', 'source/api/delete.test.ts', 'reuse');

    return {
        assignments: [
            { lane: first.id, unit: warmup.id },
            { lane: first.id, unit: warmCrash.id },
            { lane: second.id, unit: cold.id },
            { lane: first.id, unit: warmAfterCrash.id }
        ],
        lanes: [ first, second ],
        units: [ warmup, warmCrash, cold, warmAfterCrash ]
    };
}

function pullRequiredLease(
    dispatcher: WorkerPoolWorkDispatcher,
    lane: PlacementLane
): WorkerPoolUnitLease {
    const lease = dispatcher.pull(lane);

    if (lease === null) {
        throw new Error('Worker-pool warm-lane dispatch fixture expected a lease.');
    }

    return lease;
}

function finishSuccessfulPrimary(dispatcher: WorkerPoolWorkDispatcher, lease: WorkerPoolUnitLease): void {
    dispatcher.finish(lease, {
        learnWarmth: true,
        retainReservation: true,
        workerCrashed: false
    });
}

function finishCrashedPrimary(dispatcher: WorkerPoolWorkDispatcher, lease: WorkerPoolUnitLease): void {
    dispatcher.finish(lease, {
        learnWarmth: false,
        retainReservation: false,
        workerCrashed: true
    });
}

function warmAffinityTraceEntry(entry: PlacementTraceEntry | undefined): WarmAffinityTraceEntry {
    if (entry?.kind === 'warm-lane-affinity-selected') {
        return entry;
    }

    throw new Error('Expected a warm-lane-affinity-selected trace entry.');
}

function assertWarmAffinitySelection(
    scope: OverkillScope,
    runtime: WorkerPoolRunRuntime,
    plan: PlacementPlan,
    selected: WorkerPoolUnitLease
): void {
    const baselineUnit = plan.units[1];
    const selectedUnit = plan.units[2];
    const trace = warmAffinityTraceEntry(runtime.placementTraceEntries[0]);

    scope.require.defined(baselineUnit);
    scope.require.defined(selectedUnit);
    scope.assert.equal(selected.unit.id.key, 'warm');
    scope.assert.deepEqual(trace.baselineUnit, baselineUnit.id);
    scope.assert.deepEqual(trace.selectedUnit, selectedUnit.id);
    scope.assert.deepEqual(trace.matchedWarmKeys, [ 'directory', 'runtime-workload' ]);
    scope.assert.equal(trace.score, 5);
}

export const testNode = createOverkillSuite({
    ...testCaseMetadata,
    title: 'source/run/worker-pool-warm-lane-dispatch.test.ts',
    children: [
        createOverkillTestCase({
            ...testCaseMetadata,
            title: 'worker-pool dynamic dispatcher prefers warm reusable lanes within equal load',
            body(scope: OverkillScope) {
                const plan = warmAffinityPlan('reuse');
                const runtime = fakeWorkerRuntime(plan);
                const dispatcher = createWorkDispatcher(runtime, plan);
                const warmup = pullRequiredLease(dispatcher, firstLane(plan));

                scope.assert.equal(warmup.unit.id.key, 'warmup');
                finishSuccessfulPrimary(dispatcher, warmup);
                const selected = pullRequiredLease(dispatcher, firstLane(plan));

                assertWarmAffinitySelection(scope, runtime, plan, selected);
                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            ...testCaseMetadata,
            title: 'worker-pool dynamic dispatcher ignores warm data for fresh-worker units',
            body(scope: OverkillScope) {
                const plan = warmAffinityPlan('fresh-worker-per-unit');
                const runtime = fakeWorkerRuntime(plan);
                const dispatcher = createWorkDispatcher(runtime, plan);
                const warmup = pullRequiredLease(dispatcher, firstLane(plan));

                finishSuccessfulPrimary(dispatcher, warmup);
                const selected = pullRequiredLease(dispatcher, firstLane(plan));

                scope.assert.equal(selected.unit.id.key, 'cold');
                scope.assert.deepEqual(runtime.placementTraceEntries, []);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            ...testCaseMetadata,
            title: 'worker-pool dynamic dispatcher clears warm data after worker crashes',
            body(scope: OverkillScope) {
                const plan = warmAffinityCrashPlan();
                const runtime = fakeWorkerRuntime(plan);
                const dispatcher = createWorkDispatcher(runtime, plan);
                const warmup = pullRequiredLease(dispatcher, firstLane(plan));

                finishSuccessfulPrimary(dispatcher, warmup);
                finishCrashedPrimary(dispatcher, pullRequiredLease(dispatcher, firstLane(plan)));
                const selected = pullRequiredLease(dispatcher, firstLane(plan));

                scope.assert.equal(selected.unit.id.key, 'cold');
                scope.assert.deepEqual(runtime.placementTraceEntries, []);

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
