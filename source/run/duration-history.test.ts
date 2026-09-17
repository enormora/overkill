import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import type { RunResult } from '../engine/run-result.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import {
    type DurationHistoryIndex,
    type DurationHistoryPlacement,
    type DurationHistoryStore,
    mergeDurationHistoryIndex,
    readDurationHistoryIndex,
    resultWithUpdatedDurationHistory,
    selectDurationHistoryPlacement
} from './duration-history.ts';
import {
    emptyWorkUnitResourceConstraints,
    type DurationHistoryObservation,
    type WorkId,
    type WorkUnit
} from './run-types.ts';
import {
    createCollectedPlan,
    workerPoolResolvedRun
} from './worker-pool-runtime.test.ts';
import {
    workerPoolLanes,
    workerPoolPlacementAssignments
} from './worker-pool-lanes.ts';

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

type RecordedDurationHistoryStore = {
    readonly store: DurationHistoryStore;
    readonly writes: readonly string[];
};

type DurationHistoryUpdateResults = {
    readonly failedResult: RunResult;
    readonly finiteResult: RunResult;
    readonly infiniteResult: RunResult;
    readonly persistedResult: RunResult;
    readonly unchangedResult: RunResult;
    readonly writes: readonly string[];
};

function work(title: string): WorkId {
    return {
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
        id: { key, mode: 'case', runtimes: [], workload: null },
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

function expectedReadErrorMessage(): string {
    return `Failed to read duration history at ${process.cwd()}/.overkill/duration-history/work-durations.json.`;
}

function fallbackPlacements(): FallbackPlacements {
    const sampledWork = work('sampled');
    const unsampledWork = work('unsampled');
    const mixedUnit = unit('mixed', [ sampledWork, unsampledWork ]);
    const sampledIndex = mergeDurationHistoryIndex(null, [
        {
            observations: [ observation(100, now) ],
            work: sampledWork
        }
    ], observedAt(now));
    const staleIndex = mergeDurationHistoryIndex(null, [
        {
            observations: [ observation(100, now - 31 * 24 * 60 * 60 * 1000) ],
            work: sampledWork
        }
    ], observedAt(now));
    const futureIndex = mergeDurationHistoryIndex(null, [
        {
            observations: [ observation(100, now + 1) ],
            work: sampledWork
        }
    ], observedAt(now));
    const invalidDurationIndex = mergeDurationHistoryIndex(null, [
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

function runResultForWork(sampleWork: WorkId, wallTimeMs: number): RunResult {
    return runResultFactory.build({
        perTest: [
            {
                id: sampleWork.case,
                wallTimeMs,
                workId: sampleWork
            }
        ]
    });
}

function recordingDurationHistoryStore(): RecordedDurationHistoryStore {
    const writes: string[] = [];

    return {
        store: {
            async read() {
                return null;
            },
            async write(_filePath, content) {
                writes.push(content);
            }
        },
        writes
    };
}

async function durationHistoryUpdateResults(): Promise<DurationHistoryUpdateResults> {
    const resolvedRun = workerPoolResolvedRun(createCollectedPlan());
    const sampleWork = work('persisted');
    const finiteResult = runResultForWork(sampleWork, 12);
    const infiniteResult = runResultForWork(sampleWork, Number.POSITIVE_INFINITY);
    const recordingStore = recordingDurationHistoryStore();
    const unchangedResult = await resultWithUpdatedDurationHistory(
        recordingStore.store,
        resolvedRun,
        infiniteResult,
        now
    );
    const persistedResult = await resultWithUpdatedDurationHistory(
        recordingStore.store,
        resolvedRun,
        finiteResult,
        now
    );
    const failedResult = await resultWithUpdatedDurationHistory(
        {
            async read() {
                return null;
            },
            async write() {
                throw new Error('Write failed.');
            }
        },
        resolvedRun,
        finiteResult,
        now
    );

    return {
        failedResult,
        finiteResult,
        infiniteResult,
        persistedResult,
        unchangedResult,
        writes: recordingStore.writes
    };
}

function assertDurationHistoryUpdateResults(
    scope: OverkillScope,
    results: DurationHistoryUpdateResults
): void {
    scope.assert.equal(results.unchangedResult, results.infiniteResult);
    scope.assert.equal(results.persistedResult, results.finiteResult);
    scope.assert.equal(results.writes.length, 1);
    scope.assert.equal(
        results.failedResult.runnerErrors[0]?.message,
        'Failed to write duration history.'
    );
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
            title: 'duration history rejects unsupported shapes and wraps read errors',
            async body(scope: OverkillScope) {
                let requestedPath = '';
                const absoluteRuntimeStateDir = `${process.cwd()}/target/duration-history-test`;
                const invalidShapeMessage = await readHistoryFailure({
                    async read(filePath) {
                        requestedPath = filePath;

                        return JSON.stringify({ entries: [], updatedAt: observedAt(now), version: 2 });
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

                scope.assert.equal(requestedPath, `${absoluteRuntimeStateDir}/duration-history/work-durations.json`);
                scope.assert.equal(
                    invalidShapeMessage,
                    `Duration history at ${requestedPath} has an unsupported shape.`
                );
                scope.assert.equal(
                    readErrorMessage,
                    expectedReadErrorMessage()
                );

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
                            observation(70, now),
                            observation(50, now - 1),
                            observation(500, now - 31 * 24 * 60 * 60 * 1000)
                        ],
                        work: selectedWork
                    }
                ], observedAt(now));
                const placement = selectDurationHistoryPlacement([ selectedUnit ], index, now);

                scope.assert.equal(placement.facts?.samples[0]?.durationMilliseconds, 50);
                scope.assert.equal(placement.unitDuration?.(selectedUnit), 50);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'duration-history-balanced falls back for cold, stale, and partially sampled work',
            body(scope: OverkillScope) {
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
        }),
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'duration history persists finite result samples and reports write errors',
            async body(scope: OverkillScope) {
                const results = await durationHistoryUpdateResults();

                assertDurationHistoryUpdateResults(scope, results);

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
