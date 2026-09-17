import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import {
    type DurationHistoryIndex,
    mergeDurationHistoryIndex,
    readDurationHistoryIndex,
    selectDurationHistoryPlacement
} from './duration-history.ts';
import {
    emptyWorkUnitResourceConstraints,
    type DurationHistoryObservation,
    type WorkId,
    type WorkUnit
} from './run-types.ts';
import {
    workerPoolLanes,
    workerPoolPlacementAssignments
} from './worker-pool-lanes.ts';

const now = Date.parse('2026-09-17T00:00:00.000Z');

function work(title: string): WorkId {
    return {
        case: {
            file: `source/${title}.test.ts`,
            params: null,
            suite: [],
            title
        },
        runtime: null,
        workload: null
    };
}

function unit(key: string, unitWork: readonly [WorkId, ...WorkId[]]): WorkUnit {
    return {
        group: null,
        id: { key, mode: 'case', runtime: null, workload: null },
        order: 'plan',
        resourceConstraints: emptyWorkUnitResourceConstraints,
        scheduling: 'concurrent',
        work: unitWork,
        workerLifecycle: 'reuse'
    };
}

function observedAt(milliseconds: number): string {
    const date = new Date(milliseconds);

    return date.toISOString();
}

function observation(durationMilliseconds: number, observedAtMilliseconds: number): DurationHistoryObservation {
    return {
        durationMilliseconds,
        metadata: {
            processModel: 'supervised-process' as const,
            profile: 'integration',
            scheduling: 'serial' as const,
            testFamily: 'integration' as const,
            workerLifecycle: null
        },
        observedAt: observedAt(observedAtMilliseconds)
    };
}

async function invalidJsonHistoryRejected(): Promise<boolean> {
    try {
        await readDurationHistoryIndex(
            {
                async read() {
                    return 'not json';
                },
                async write() {
                    return undefined;
                }
            },
            process.cwd(),
            '.overkill'
        );

        return false;
    } catch {
        return true;
    }
}

function durationLaneAssignments(
    units: readonly WorkUnit[],
    unitDuration: ((unit: WorkUnit) => number) | null
): readonly string[] {
    const lanes = workerPoolLanes({
        assignmentPolicy: 'duration-history-balanced',
        availableParallelism: 3,
        units
    });

    return workerPoolPlacementAssignments(
        units,
        lanes,
        'duration-history-balanced',
        unitDuration
    )
        .map(function toLane(assignment) {
            return assignment.lane;
        });
}

function balancedDurationIndex(slow: WorkUnit, fastA: WorkUnit, fastB: WorkUnit): DurationHistoryIndex {
    return mergeDurationHistoryIndex(null, [
        {
            observations: [ observation(100, now) ],
            work: slow.work[0]
        },
        {
            observations: [ observation(10, now) ],
            work: fastA.work[0]
        },
        {
            observations: [ observation(10, now) ],
            work: fastB.work[0]
        }
    ], observedAt(now));
}

export const testNode = createOverkillSuite({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/duration-history.test.ts',
    children: [
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'duration history reads missing files as cold start and rejects invalid JSON',
            async body(scope: OverkillScope) {
                const missingHistory = await readDurationHistoryIndex(
                    {
                        async read() {
                            return null;
                        },
                        async write() {
                            return undefined;
                        }
                    },
                    process.cwd(),
                    '.overkill'
                );

                scope.assert.equal(
                    missingHistory,
                    null
                );

                scope.assert.equal(await invalidJsonHistoryRejected(), true);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'duration history uses median fresh observations and ignores stale samples',
            body(scope: OverkillScope) {
                const selectedWork = work('selected');
                const selectedUnit = unit('selected', [ selectedWork ]);
                const index = mergeDurationHistoryIndex(null, [
                    {
                        observations: [
                            observation(10, now),
                            observation(50, now - 1),
                            observation(500, now - 31 * 24 * 60 * 60 * 1000)
                        ],
                        work: selectedWork
                    }
                ], observedAt(now));
                const placement = selectDurationHistoryPlacement([ selectedUnit ], index, now);

                scope.assert.equal(placement.facts?.samples[0]?.durationMilliseconds, 30);
                scope.assert.equal(placement.unitDuration?.(selectedUnit), 30);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'duration-history-balanced balances lanes by duration and falls back when sparse',
            body(scope: OverkillScope) {
                const slow = unit('slow', [ work('slow') ]);
                const fastA = unit('fast-a', [ work('fast-a') ]);
                const fastB = unit('fast-b', [ work('fast-b') ]);
                const units = [ slow, fastA, fastB ];
                const placement = selectDurationHistoryPlacement(units, balancedDurationIndex(slow, fastA, fastB), now);

                scope.assert.deepEqual(
                    durationLaneAssignments(units, placement.unitDuration),
                    [ 'worker-1', 'worker-2', 'worker-2' ]
                );

                const sparsePlacement = selectDurationHistoryPlacement(
                    units,
                    mergeDurationHistoryIndex(null, [
                        {
                            observations: [ observation(100, now) ],
                            work: slow.work[0]
                        }
                    ], observedAt(now)),
                    now
                );

                scope.assert.equal(sparsePlacement.facts, null);
                scope.assert.equal(sparsePlacement.unitDuration, null);

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
