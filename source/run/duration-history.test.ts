import { type TestScope as OverkillScope, suite, test } from '@overkill-dev/test';

import type { DurationHistoryIndex, DurationHistoryPlacement, DurationHistoryStore } from './duration-history-types.ts';
import { readDurationHistoryIndex, selectDurationHistoryPlacement } from './duration-history.ts';
import {
    emptyWorkUnitResourceConstraints,
    type DurationHistoryObservation,
    type WorkId,
    type WorkUnit
} from './run-types.ts';
import { workerPoolLanes, workerPoolPlacementAssignments } from './worker-pool-lanes.ts';

function historyIndex(entries: DurationHistoryIndex['entries'], updatedAt: string): DurationHistoryIndex {
    return { entries, updatedAt };
}

const now = Date.parse('2026-09-17T00:00:00.000Z');

type FallbackPlacements = {
    readonly cold: DurationHistoryPlacement;
    readonly empty: DurationHistoryPlacement;
    readonly future: DurationHistoryPlacement;
    readonly invalidDuration: DurationHistoryPlacement;
    readonly mixedUnit: WorkUnit;
    readonly partial: DurationHistoryPlacement;
    readonly stale: DurationHistoryPlacement;
};

function work(title: string): WorkId {
    return {
        familyVariant: null,
        case: {
            file: `source/${title}.test.ts`,
            params: null,
            suite: [],
            title
        },
        runtimes: [],
        workload: null
    };
}

function unit(key: string, unitWork: readonly [WorkId, ...WorkId[]]): WorkUnit {
    return {
        group: null,
        id: { familyVariant: null, key, mode: 'case', runtimes: [], workload: null },
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

function observation(durationMicroseconds: number, observedAtMilliseconds: number): DurationHistoryObservation {
    return {
        durationMicroseconds,
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
        maximumWorkers: null,
        profileMaximum: null,
        requestedWorkers: null,
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
    return historyIndex([
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

async function readHistoryFailure(
    store: DurationHistoryStore,
    runtimeStateDir: string
): Promise<string> {
    try {
        await readDurationHistoryIndex(store, process.cwd(), runtimeStateDir);

        return 'not rejected';
    } catch (error: unknown) {
        return error instanceof Error ? error.message : 'unknown rejection';
    }
}

function fallbackPlacements(): FallbackPlacements {
    const sampledWork = work('sampled');
    const unsampledWork = work('unsampled');
    const mixedUnit = unit('mixed', [ sampledWork, unsampledWork ]);
    const sampledIndex = historyIndex([
        {
            observations: [ observation(100, now) ],
            work: sampledWork
        }
    ], observedAt(now));
    const staleIndex = historyIndex([
        {
            observations: [ observation(100, now - 31 * 24 * 60 * 60 * 1000) ],
            work: sampledWork
        }
    ], observedAt(now));
    const futureIndex = historyIndex([
        {
            observations: [ observation(100, now + 1) ],
            work: sampledWork
        }
    ], observedAt(now));
    const invalidDurationIndex = historyIndex([
        {
            observations: [ observation(Number.NaN, now) ],
            work: sampledWork
        }
    ], observedAt(now));

    return {
        cold: selectDurationHistoryPlacement([ mixedUnit ], null, now),
        empty: selectDurationHistoryPlacement([], sampledIndex, now),
        future: selectDurationHistoryPlacement([ unit('future', [ sampledWork ]) ], futureIndex, now),
        invalidDuration: selectDurationHistoryPlacement(
            [ unit('invalid-duration', [ sampledWork ]) ],
            invalidDurationIndex,
            now
        ),
        mixedUnit,
        partial: selectDurationHistoryPlacement([ mixedUnit ], sampledIndex, now),
        stale: selectDurationHistoryPlacement([ unit('sampled', [ sampledWork ]) ], staleIndex, now)
    };
}

export const testNode = suite('source/run/duration-history.test.ts', [
    test(
        'duration history reads missing files as cold start and rejects invalid JSON',
        async function (scope: OverkillScope) {
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
    ),
    test('duration history rejects unsupported shapes and wraps read errors', async function (scope: OverkillScope) {
        let requestedPath = '';
        const absoluteRuntimeStateDir = `${process.cwd()}/target/duration-history-test`;
        const invalidShapeMessage = await readHistoryFailure({
            async read(filePath) {
                requestedPath = filePath;

                return JSON.stringify({ entries: [], updatedAt: observedAt(now), version: 1 });
            },
            async write() {
                return undefined;
            }
        }, absoluteRuntimeStateDir);
        const readErrorMessage = await readHistoryFailure({
            async read() {
                throw new Error('Read failed.');
            },
            async write() {
                return undefined;
            }
        }, '.overkill');

        scope.assert.equal(requestedPath, `${absoluteRuntimeStateDir}/history/index.json`);
        scope.assert.equal(
            invalidShapeMessage,
            'History state is unavailable. Run overkill history compact to repair it.'
        );
        scope.assert.equal(
            readErrorMessage,
            'History state is unavailable. Run overkill history compact to repair it.'
        );

        return scope.assert.collect();
    }),
    test('duration history uses median fresh observations and ignores stale samples', function (scope: OverkillScope) {
        const selectedWork = work('selected');
        const selectedUnit = unit('selected', [ selectedWork ]);
        const index = historyIndex([
            {
                observations: [
                    observation(10, now),
                    observation(70, now),
                    observation(50, now - 1),
                    observation(500, now - 31 * 24 * 60 * 60 * 1000)
                ],
                work: selectedWork
            }
        ], observedAt(now));
        const placement = selectDurationHistoryPlacement([ selectedUnit ], index, now);

        scope.assert.equal(placement.facts?.samples[0]?.durationMicroseconds, 50);
        scope.assert.equal(placement.unitDuration?.(selectedUnit), 50);

        return scope.assert.collect();
    }),
    test(
        'duration-history-balanced falls back for cold, stale, and partially sampled work',
        function (scope: OverkillScope) {
            const scenarios = fallbackPlacements();

            scope.assert.equal(scenarios.partial.unitDuration?.(scenarios.mixedUnit), 200);
            scope.assert.equal(scenarios.cold.facts, null);
            scope.assert.equal(scenarios.cold.unitDuration, null);
            scope.assert.equal(scenarios.empty.facts, null);
            scope.assert.equal(scenarios.future.facts, null);
            scope.assert.equal(scenarios.invalidDuration.facts, null);
            scope.assert.equal(scenarios.stale.facts, null);

            return scope.assert.collect();
        }
    ),
    test(
        'duration-history-balanced balances lanes by duration and falls back when sparse',
        function (scope: OverkillScope) {
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
                historyIndex([
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
    )
]);
