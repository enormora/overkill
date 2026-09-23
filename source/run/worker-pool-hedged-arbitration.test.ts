import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type PerTestResult,
    type RunResult,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { workIdentityKey } from '../engine/identity.ts';
import { summaryRunTimings } from '../engine/run-timings.ts';
import { createSupervisedRunState } from './supervised-run-state.ts';
import {
    createCollectedPlan,
    createTaskRun,
    fakeWorkerRuntime
} from './worker-pool-execution-state.test.ts';
import {
    recordCancelledHedgedTaskRun,
    recordCompletedHedgedTaskRun,
    unitCanUseBufferedHedging,
    type HedgedAuthorities
} from './worker-pool-hedged-arbitration.ts';
import type { WorkerPoolRunRuntime, WorkerPoolTaskRun } from './worker-pool-runtime.ts';

const integrationPath = 'source/integration-tests/run/fixtures/passing.test.ts';
const testCaseMetadata = {
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' as const } ]
} as const;

function firstCaseId(): PerTestResult['id'] {
    return {
        file: integrationPath,
        params: null,
        suite: [ 'integration' ],
        title: 'first'
    };
}

function passResult(): PerTestResult {
    const id = firstCaseId();

    return {
        id,
        outcome: { kind: 'pass' },
        verdict: 'pass',
        durationMicroseconds: 0,
        workId: { case: id, runtimes: [], workload: null }
    };
}

function failResult(): PerTestResult {
    const result = passResult();

    return {
        ...result,
        outcome: {
            failures: [ {
                error: {
                    message: 'duplicate failed',
                    name: 'Error',
                    stack: null,
                    thrown: new Error('duplicate failed')
                },
                kind: 'body-error'
            } ],
            kind: 'fail'
        },
        verdict: 'fail'
    };
}

function emptyRunResult(perTest: readonly PerTestResult[]): RunResult {
    return {
        artifacts: [],
        bySuite: {},
        orphans: [],
        perTest,
        planStatus: 'planned',
        resourceUsage: null,
        runnerErrors: [],
        status: 'passed',
        summary: {
            crashed: 0,
            defined: 0,
            discovered: 0,
            failed: 0,
            inconclusive: 0,
            passed: perTest.length,
            planned: perTest.length,
            resourceExhausted: 0,
            runtimePolicy: 0,
            skipped: 0
        },
        timings: summaryRunTimings({
            testExecutionWallTimeMicroseconds: 0,
            totalWallTimeMicroseconds: 0
        })
    };
}

function runResult(perTest: PerTestResult): RunResult {
    return emptyRunResult([ perTest ]);
}

function taskRunWithLane(lane: string): WorkerPoolTaskRun {
    return {
        ...createTaskRun(createSupervisedRunState()),
        lane,
        reporterEventsBuffered: true
    };
}

function hedgedRuntime(): WorkerPoolRunRuntime {
    return fakeWorkerRuntime(createCollectedPlan());
}

function runtimeWithHedging(): WorkerPoolRunRuntime {
    const runtime = hedgedRuntime();
    const { execution } = runtime.resolvedRun.facts;

    if (execution.processModel !== 'worker-pool') {
        throw new Error('Worker-pool fixture requires worker-pool execution facts.');
    }

    return {
        ...runtime,
        resolvedRun: {
            ...runtime.resolvedRun,
            facts: {
                ...runtime.resolvedRun.facts,
                execution: {
                    ...execution,
                    hedging: {
                        durationMultiplier: 1,
                        minimumDelayMilliseconds: 0,
                        mode: 'on'
                    }
                }
            }
        }
    };
}

function authorityMap(taskRun: WorkerPoolTaskRun, result: RunResult): HedgedAuthorities {
    return new Map([ [
        workIdentityKey(taskRun.unit.work[0]),
        {
            result,
            taskRun
        }
    ] ]);
}

function bufferStartEvent(taskRun: WorkerPoolTaskRun): void {
    taskRun.bufferedReporterEvents.push({
        attempt: 1,
        case: firstCaseId(),
        definitionLocations: [ { kind: 'unknown' } ],
        kind: 'test-start',
        suitePath: [ { definitionLocations: [ { kind: 'unknown' } ], title: 'integration' } ],
        workId: passResult().workId
    });
}

function flattenPerTest(runtime: WorkerPoolRunRuntime): readonly PerTestResult[] {
    return runtime.taskResults.flatMap(function toCases(result) {
        return result.perTest;
    });
}

async function cancelHedgedPeer(
    runtime: WorkerPoolRunRuntime,
    authorities: HedgedAuthorities,
    authorityTask: WorkerPoolTaskRun,
    peerTask: WorkerPoolTaskRun
): Promise<{
    readonly peerTask: WorkerPoolTaskRun;
    readonly runtime: WorkerPoolRunRuntime;
}> {
    runtime.activeTasks.delete(authorityTask);
    recordCancelledHedgedTaskRun(authorities, peerTask, runtime);
    await runtime.reporterEvents.wait();

    return { peerTask, runtime };
}

async function cancelledHedgedPeerResult(): Promise<{
    readonly peerTask: WorkerPoolTaskRun;
    readonly runtime: WorkerPoolRunRuntime;
}> {
    const runtime = hedgedRuntime();
    const authorityTask = taskRunWithLane('worker-1');
    const peerTask = taskRunWithLane('worker-2');
    const authorities: HedgedAuthorities = new Map();

    bufferStartEvent(authorityTask);
    runtime.activeTasks.add(authorityTask);
    runtime.activeTasks.add(peerTask);
    await recordCompletedHedgedTaskRun(authorities, runResult(passResult()), authorityTask, runtime);

    return cancelHedgedPeer(runtime, authorities, authorityTask, peerTask);
}

async function matchingHedgedDuplicateResult(): Promise<{
    readonly duplicateTask: WorkerPoolTaskRun;
    readonly runtime: WorkerPoolRunRuntime;
}> {
    const runtime = hedgedRuntime();
    const authorityTask = taskRunWithLane('worker-1');
    const duplicateTask = taskRunWithLane('worker-2');

    await recordCompletedHedgedTaskRun(
        authorityMap(authorityTask, runResult(passResult())),
        runResult(passResult()),
        duplicateTask,
        runtime
    );

    return { duplicateTask, runtime };
}

async function conflictingHedgedResult(): Promise<WorkerPoolRunRuntime> {
    const runtime = hedgedRuntime();
    const authorityTask = taskRunWithLane('worker-1');
    const conflictingTask = taskRunWithLane('worker-2');

    await recordCompletedHedgedTaskRun(
        authorityMap(authorityTask, runResult(passResult())),
        runResult(failResult()),
        conflictingTask,
        runtime
    );

    return runtime;
}

async function firstHedgedAuthorityResult(): Promise<WorkerPoolRunRuntime> {
    const runtime = hedgedRuntime();
    const authorityTask = taskRunWithLane('worker-1');

    await recordCompletedHedgedTaskRun(new Map(), runResult(passResult()), authorityTask, runtime);

    return runtime;
}

async function emptyHedgedConflictResult(): Promise<WorkerPoolRunRuntime> {
    const runtime = hedgedRuntime();
    const authorityTask = taskRunWithLane('worker-1');
    const conflictingTask = taskRunWithLane('worker-2');

    await recordCompletedHedgedTaskRun(
        authorityMap(authorityTask, emptyRunResult([])),
        runResult(failResult()),
        conflictingTask,
        runtime
    );

    return runtime;
}

function reusableDisposableUnit(taskRun: WorkerPoolTaskRun): WorkerPoolTaskRun['unit'] {
    return {
        ...taskRun.unit,
        resourceConstraints: {
            ...taskRun.unit.resourceConstraints,
            duplicateExecution: [ 'disposable-isolated' ]
        }
    };
}

function multiWorkUnit(
    taskRun: WorkerPoolTaskRun,
    duplicateWork: WorkerPoolTaskRun['unit']['work'][number]
): WorkerPoolTaskRun['unit'] {
    return {
        ...taskRun.unit,
        resourceConstraints: {
            ...taskRun.unit.resourceConstraints,
            duplicateExecution: [ 'idempotent' ]
        },
        work: [ duplicateWork, duplicateWork ]
    };
}

function idempotentUnit(taskRun: WorkerPoolTaskRun): WorkerPoolTaskRun['unit'] {
    return {
        ...taskRun.unit,
        resourceConstraints: {
            ...taskRun.unit.resourceConstraints,
            duplicateExecution: [ 'idempotent' ]
        }
    };
}

function disposableIsolatedUnit(taskRun: WorkerPoolTaskRun): WorkerPoolTaskRun['unit'] {
    return {
        ...taskRun.unit,
        resourceConstraints: {
            ...taskRun.unit.resourceConstraints,
            duplicateExecution: [ 'disposable-isolated' ]
        },
        workerLifecycle: 'fresh-worker-per-unit'
    };
}

export const testNode = createOverkillSuite({
    ...testCaseMetadata,
    title: 'source/run/worker-pool-hedged-arbitration.test.ts',
    children: [
        createOverkillTestCase({
            ...testCaseMetadata,
            title: 'worker-pool hedged arbitration finalizes the winner after cancelling a peer',
            async body(scope: OverkillScope) {
                const { peerTask, runtime } = await cancelledHedgedPeerResult();

                scope.assert.equal(peerTask.endedByParent.read(), true);
                scope.assert.equal(peerTask.includeArtifacts.read(), false);
                scope.assert.equal(flattenPerTest(runtime).length, 1);
                scope.assert.deepEqual(
                    runtime.placementTraceEntries.map(function toKind(entry) {
                        return entry.kind;
                    }),
                    [ 'hedged-duplicate-discarded' ]
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            ...testCaseMetadata,
            title: 'worker-pool hedged arbitration fails conflicting duplicate outcomes',
            async body(scope: OverkillScope) {
                const runtime = await conflictingHedgedResult();
                const result = flattenPerTest(runtime)[0];

                scope.require.defined(result);
                scope.assert.equal(result.verdict, 'fail');
                scope.require.defined(result.outcome);
                scope.assert.equal(result.outcome.kind, 'fail');
                scope.assert.equal(runtime.runState.artifacts()[0]?.payload.kind, 'hedged-conflict');
                scope.assert.deepEqual(
                    runtime.placementTraceEntries.map(function toKind(entry) {
                        return entry.kind;
                    }),
                    [ 'hedged-duplicate-conflict' ]
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            ...testCaseMetadata,
            title: 'worker-pool hedged arbitration finalizes a lone first authority',
            async body(scope: OverkillScope) {
                scope.assert.equal(flattenPerTest(await firstHedgedAuthorityResult()).length, 1);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            ...testCaseMetadata,
            title: 'worker-pool hedged arbitration ignores conflicts without comparable results',
            async body(scope: OverkillScope) {
                const runtime = await emptyHedgedConflictResult();

                scope.assert.equal(flattenPerTest(runtime).length, 0);
                scope.assert.equal(runtime.runState.artifacts().length, 0);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            ...testCaseMetadata,
            title: 'worker-pool hedged arbitration discards matching duplicate outcomes',
            async body(scope: OverkillScope) {
                const { duplicateTask, runtime } = await matchingHedgedDuplicateResult();

                scope.assert.equal(duplicateTask.includeArtifacts.read(), false);
                scope.assert.equal(flattenPerTest(runtime).length, 1);
                scope.assert.deepEqual(
                    runtime.placementTraceEntries.map(function toKind(entry) {
                        return entry.kind;
                    }),
                    [ 'hedged-duplicate-discarded' ]
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            ...testCaseMetadata,
            title: 'worker-pool hedged arbitration buffers only safe single-work units',
            body(scope: OverkillScope) {
                const runtime = runtimeWithHedging();
                const taskRun = taskRunWithLane('worker-1');
                const duplicateWork = taskRun.unit.work[0];

                scope.require.defined(duplicateWork);
                scope.assert.equal(unitCanUseBufferedHedging(hedgedRuntime(), taskRun.unit), false);
                scope.assert.equal(unitCanUseBufferedHedging(runtime, reusableDisposableUnit(taskRun)), false);
                scope.assert.equal(unitCanUseBufferedHedging(runtime, multiWorkUnit(taskRun, duplicateWork)), false);
                scope.assert.equal(unitCanUseBufferedHedging(runtime, idempotentUnit(taskRun)), true);
                scope.assert.equal(unitCanUseBufferedHedging(runtime, disposableIsolatedUnit(taskRun)), true);

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
