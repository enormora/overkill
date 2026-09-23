import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import type { PlacementPlan } from './run-types.ts';
import {
    fakeWorkerRuntime,
    placementPlan,
    testCaseMetadata
} from './worker-pool-placement-validation.test.ts';
import { runtimeUnitLoad } from './worker-pool-work-load.ts';
import type { WorkerPoolRunRuntime } from './worker-pool-runtime.ts';

type WorkUnit = PlacementPlan['units'][number];
type PlacementLane = PlacementPlan['lanes'][number];
type DurationHistorySample = NonNullable<
    WorkerPoolRunRuntime['resolvedRun']['facts']['durationHistory']
>['samples'][number];

function firstLane(plan: PlacementPlan): PlacementLane {
    const lane = plan.lanes[0];

    if (lane === undefined) {
        throw new Error('Worker-pool work-load fixture requires a lane.');
    }

    return lane;
}

function firstUnit(plan: PlacementPlan): WorkUnit {
    const unit = plan.units[0];

    if (unit === undefined) {
        throw new Error('Worker-pool work-load fixture requires a work unit.');
    }

    return unit;
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

function firstWork(unit: WorkUnit): WorkUnit['work'][number] {
    return unit.work[0];
}

function secondWork(unit: WorkUnit): WorkUnit['work'][number] {
    const work = firstWork(unit);

    return {
        ...work,
        case: {
            ...work.case,
            title: 'second'
        }
    };
}

function multiWorkUnit(): WorkUnit {
    const unit = firstUnit(placementPlan());

    return {
        ...unit,
        scheduling: 'concurrent',
        work: [ firstWork(unit), secondWork(unit) ]
    };
}

function twoLanePlan(unit: WorkUnit): PlacementPlan {
    const first = workerLane('worker-1');
    const second = workerLane('worker-2');

    return {
        assignments: [ { lane: first.id, unit: unit.id } ],
        lanes: [ first, second ],
        units: [ unit ]
    };
}

function runtimeWithEmptyDurationHistory(plan: PlacementPlan): WorkerPoolRunRuntime {
    const runtime = fakeWorkerRuntime(plan);
    const { execution } = runtime.resolvedRun.facts;

    if (execution.processModel !== 'worker-pool') {
        throw new Error('Worker-pool work-load fixture requires worker-pool execution facts.');
    }

    return {
        ...runtime,
        resolvedRun: {
            ...runtime.resolvedRun,
            facts: {
                ...runtime.resolvedRun.facts,
                durationHistory: {
                    generatedAt: '2026-01-01T00:00:00.000Z',
                    samples: [],
                    source: 'runtime-state-index'
                },
                execution: {
                    ...execution,
                    assignmentPolicy: 'duration-history-balanced',
                    placementPlan: plan
                }
            }
        }
    };
}

function durationSample(work: WorkUnit['work'][number], durationMicroseconds: number): DurationHistorySample {
    return {
        durationMicroseconds,
        observedAt: '2026-01-01T00:00:00.000Z',
        observations: [],
        sampleCount: 1,
        work
    };
}

function sampleOnlyWork(unit: WorkUnit): WorkUnit['work'][number] {
    return {
        ...firstWork(unit),
        case: {
            ...firstWork(unit).case,
            title: 'sample-only'
        }
    };
}

function runtimeWithDurationHistorySamples(plan: PlacementPlan, unit: WorkUnit): WorkerPoolRunRuntime {
    const runtime = runtimeWithEmptyDurationHistory(plan);

    return {
        ...runtime,
        resolvedRun: {
            ...runtime.resolvedRun,
            facts: {
                ...runtime.resolvedRun.facts,
                durationHistory: {
                    generatedAt: '2026-01-01T00:00:00.000Z',
                    samples: [
                        durationSample(firstWork(unit), 100_000),
                        durationSample(sampleOnlyWork(unit), 300_000)
                    ],
                    source: 'runtime-state-index'
                }
            }
        }
    };
}

function runtimeWithSingleDurationHistorySample(plan: PlacementPlan, unit: WorkUnit): WorkerPoolRunRuntime {
    const runtime = runtimeWithEmptyDurationHistory(plan);

    return {
        ...runtime,
        resolvedRun: {
            ...runtime.resolvedRun,
            facts: {
                ...runtime.resolvedRun.facts,
                durationHistory: {
                    generatedAt: '2026-01-01T00:00:00.000Z',
                    samples: [ durationSample(firstWork(unit), 100_000) ],
                    source: 'runtime-state-index'
                }
            }
        }
    };
}

function assertDurationHistoryLoadUsesMedianFallback(scope: OverkillScope): void {
    const unit = multiWorkUnit();
    const plan = twoLanePlan(unit);
    const runtime = runtimeWithDurationHistorySamples(plan, unit);

    scope.assert.equal(runtimeUnitLoad(runtime)(unit), 300_000);
    scope.assert.equal(runtimeUnitLoad(runtimeWithSingleDurationHistorySample(plan, unit))(unit), 200_000);
}

export const testNode = createOverkillSuite({
    ...testCaseMetadata,
    title: 'source/run/worker-pool-work-load.test.ts',
    children: [
        createOverkillTestCase({
            ...testCaseMetadata,
            title: 'worker-pool duration-history load uses median fallback samples',
            body(scope: OverkillScope) {
                assertDurationHistoryLoadUsesMedianFallback(scope);

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
