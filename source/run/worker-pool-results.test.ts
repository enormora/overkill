import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type PerTestResult,
    type RunResult,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { summaryRunTimings } from '../engine/run-timings.ts';
import { defaultRunRequest } from '../test-support/run-command-factory.ts';
import {
    createStoredRunValue,
    createSupervisedRunState,
    type SupervisedRunState
} from './supervised-run-state.ts';
import {
    createCollectedPlan,
    createCollectedPlanWithMissingResult,
    createTaskRun,
    fakeDependencies,
    fakeWorkerRuntime,
    workerPoolResolvedRun
} from './worker-pool-execution-state.test.ts';
import { createEmptyWorkerPoolResult, finishWorkerPoolRun } from './worker-pool-results.ts';
import type { WorkerPoolRunRuntime } from './worker-pool-runtime.ts';

type CollectedRunPlan = WorkerPoolRunRuntime['collectedPlan'];
type ResolvedRun = WorkerPoolRunRuntime['resolvedRun'];
type ReportedEvent = Parameters<WorkerPoolRunRuntime['reporterDelivery']['reportEvent']>[0];
type ReporterEventRecorder = {
    readonly record: (event: ReportedEvent) => void;
};

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

function emptyShardResolvedRun(collectedPlan: CollectedRunPlan): ResolvedRun {
    const resolvedRun = workerPoolResolvedRun({ ...collectedPlan, files: [] });
    const { placementPlan } = resolvedRun.facts.execution;

    if (placementPlan === null) {
        throw new Error('Worker-pool fixture requires a placement plan.');
    }

    return {
        ...resolvedRun,
        facts: {
            ...resolvedRun.facts,
            execution: {
                ...resolvedRun.facts.execution,
                placementPlan: {
                    ...placementPlan,
                    assignments: [],
                    units: []
                }
            },
            reproducibility: {
                ...resolvedRun.facts.reproducibility,
                shard: { index: 2, total: 2 }
            }
        },
        request: defaultRunRequest({
            paths: [ integrationPath ],
            profile: 'integration',
            shard: { index: 2, total: 2 }
        })
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

function passResult(): PerTestResult {
    const id = firstCaseId();

    return {
        definitionLocations: [ { kind: 'unknown' as const } ],
        id,
        outcome: { kind: 'pass' },
        verdict: 'pass',
        durationMicroseconds: 0,
        workId: { case: id, runtimes: [], workload: null }
    };
}

function createRecordingDependencies(recorder: ReporterEventRecorder): WorkerPoolRunRuntime['dependencies'] {
    return {
        ...fakeDependencies(),
        reporterDispatcher: {
            async createDelivery() {
                return {
                    async disposeReporters() {
                        return [];
                    },
                    async reportEvent(event) {
                        recorder.record(event);

                        return [];
                    },
                    async reportResult() {
                        return [];
                    }
                };
            },
            async trackRunnerErrorDelivery(work) {
                return { deliveredRunnerErrors: [], result: await work(), undeliveredRunnerErrors: [] };
            }
        }
    };
}

function measuredResultRuntime(): WorkerPoolRunRuntime {
    return {
        ...fakeWorkerRuntime(createCollectedPlanWithMissingResult()),
        poolResourceUsageTracker: {
            finish() {
                return {
                    activeResourceTypes: [],
                    end: {
                        activeResourceCount: 0,
                        activeResourceTypes: [],
                        capturedAtMicroseconds: 1,
                        javaScriptEngineHeapBytes: 2,
                        residentSetBytes: 3
                    },
                    peakActiveResourceCount: 0,
                    peakJavaScriptEngineHeapBytes: 2,
                    peakResidentSetBytes: 3,
                    peakResidentSetGrowthBytesPerSecond: 0,
                    sampleCount: 1,
                    start: {
                        activeResourceCount: 0,
                        activeResourceTypes: [],
                        capturedAtMicroseconds: 0,
                        javaScriptEngineHeapBytes: 1,
                        residentSetBytes: 2
                    }
                };
            },
            start() {
                return undefined;
            }
        },
        previousPoolSample: createStoredRunValue<ReturnType<WorkerPoolRunRuntime['previousPoolSample']['read']>>(null)
    };
}

function recordFinalizationArtifacts(
    runtime: WorkerPoolRunRuntime,
    activeState: SupervisedRunState,
    completedState: SupervisedRunState
): void {
    runtime.runState.recordCapturedOutput('stdout', Buffer.from('run artifact'), 1);
    activeState.recordCapturedOutput('stdout', Buffer.from('active artifact'), 3);
    completedState.recordCapturedOutput('stderr', Buffer.from('completed artifact'), 2);
}

async function workerPoolFinalizationResults(): Promise<{
    readonly emptyResult: RunResult;
    readonly result: RunResult;
}> {
    const runtime = measuredResultRuntime();
    const activeState = createSupervisedRunState();
    const completedState = createSupervisedRunState();

    recordFinalizationArtifacts(runtime, activeState, completedState);
    runtime.activeTasks.add(createTaskRun(activeState));
    runtime.taskResults.push(emptyRunResult([ passResult() ]));

    const result = await finishWorkerPoolRun(runtime, [ createTaskRun(completedState) ], 10);
    const emptyResult = await createEmptyWorkerPoolResult(
        workerPoolResolvedRun(createCollectedPlan()),
        runtime.dependencies,
        createSupervisedRunState()
    );

    return { emptyResult, result };
}

export const testNode = createOverkillSuite({
    ...testCaseMetadata,
    title: 'source/run/worker-pool-results.test.ts',
    children: [
        createOverkillTestCase({
            ...testCaseMetadata,
            title: 'worker-pool finalization and empty results aggregate run state',
            async body(scope: OverkillScope) {
                const { emptyResult, result } = await workerPoolFinalizationResults();

                scope.assert.equal(result.perTest[0]?.id.title, 'first');
                scope.assert.deepEqual(
                    result.artifacts.map(function toText(artifact) {
                        if (artifact.payload.kind !== 'captured-output') {
                            throw new Error('Expected captured output artifact.');
                        }

                        return artifact.payload.text;
                    }),
                    [ 'run artifact', 'completed artifact', 'active artifact' ]
                );
                scope.assert.equal(emptyResult.summary.planned, 1);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            ...testCaseMetadata,
            title: 'worker-pool empty shard results report a successful empty shard run',
            async body(scope: OverkillScope) {
                const events: ReportedEvent[] = [];
                const result = await createEmptyWorkerPoolResult(
                    emptyShardResolvedRun(createCollectedPlan()),
                    createRecordingDependencies({
                        record(event) {
                            events.push(event);
                        }
                    }),
                    createSupervisedRunState()
                );

                scope.assert.equal(result.planStatus, 'empty-shard');
                scope.assert.equal(result.summary.planned, 0);
                scope.assert.deepEqual(
                    events.map(function toKind(event) {
                        return event.kind;
                    }),
                    [ 'run-start', 'run-end' ]
                );

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
