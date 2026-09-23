import { workIdentityKey } from '../engine/identity.ts';
import { appendRunnerErrors } from '../engine/execution-result.ts';
import type { ReporterDelivery } from '../engine/reporter-dispatcher.ts';
import type {
    PerTestResult,
    RunArtifact,
    RunResourceUsage,
    RunResult,
    RunnerError
} from '../packages/engine/engine.entry-point.ts';
import {
    collectedRunCaseEntries,
    createRunResultFromCollectedPlan
} from './collected-run-plan.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import type { CollectedRunPlan } from './run-types.ts';
import { createReporterDelivery } from './supervised-run-runtime.ts';
import type {
    SupervisedRunState
} from './supervised-run-state.ts';
import {
    workerPoolCollectedPlan,
    type WorkerPoolRunRuntime,
    type WorkerPoolTaskRun
} from './worker-pool-runtime.ts';

function taskArtifacts(runtime: WorkerPoolRunRuntime): readonly RunArtifact[] {
    return Array.from(runtime.activeTasks).flatMap(function toArtifacts(taskRun) {
        return taskRun.state.artifacts();
    });
}

function allTaskArtifacts(completedTaskRuns: readonly WorkerPoolTaskRun[]): readonly RunArtifact[] {
    return completedTaskRuns
        .filter(function includesArtifacts(taskRun) {
            return taskRun.includeArtifacts.read();
        })
        .flatMap(function toArtifacts(taskRun) {
            return taskRun.state.artifacts();
        });
}

function allTaskErrors(
    runtime: WorkerPoolRunRuntime,
    completedTaskRuns: readonly WorkerPoolTaskRun[]
): readonly RunnerError[] {
    const hostRunnerErrors = runtime.pool.takeHostRunnerErrors?.() ?? [];

    return [
        ...runtime.collectionRunnerErrors,
        ...runtime.runState.runnerErrors(),
        ...hostRunnerErrors,
        ...completedTaskRuns.flatMap(function toErrors(taskRun) {
            return taskRun.state.runnerErrors();
        }),
        ...runtime.taskResults.flatMap(function toErrors(result) {
            return result.runnerErrors;
        })
    ];
}

function orderedPerTest(
    collectedPlan: CollectedRunPlan,
    perTest: readonly PerTestResult[]
): readonly PerTestResult[] {
    const results = new Map(perTest.map(function toEntry(result) {
        return [ workIdentityKey(result.workId), result ];
    }));

    return collectedRunCaseEntries(collectedPlan).flatMap(function toResult(entry) {
        const result = results.get(workIdentityKey(entry.workId));

        return result === undefined ? [] : [ result ];
    });
}

function resultWithArtifacts(result: RunResult, artifacts: readonly RunArtifact[]): RunResult {
    if (artifacts.length === 0) {
        return result;
    }

    return {
        ...result,
        artifacts: [ ...result.artifacts, ...artifacts ]
    };
}

function finishPoolResourceUsage(runtime: WorkerPoolRunRuntime): RunResourceUsage | null {
    return runtime.poolResourceUsageTracker?.finish() ?? null;
}

function emptyWorkerPoolPlanStatus(resolvedRun: WorkerPoolRunRuntime['resolvedRun']): RunResult['planStatus'] {
    return resolvedRun.facts.cases.length === 0 && resolvedRun.request.shard.total > 1
        ? 'empty-shard'
        : 'empty-selection';
}

function runStartTimeFromMilliseconds(milliseconds: number): string {
    const startedAt = new Date(milliseconds);

    return startedAt.toISOString();
}

async function reportEmptyShardRunStart(
    reporterDelivery: Awaited<ReturnType<typeof createReporterDelivery>>,
    resolvedRun: WorkerPoolRunRuntime['resolvedRun'],
    collectedPlan: CollectedRunPlan,
    startedAtMilliseconds: number
): Promise<readonly RunnerError[]> {
    if (emptyWorkerPoolPlanStatus(resolvedRun) !== 'empty-shard') {
        return [];
    }

    return await reporterDelivery.reportEvent({
        facts: resolvedRun.facts,
        kind: 'run-start',
        root: {
            annotations: collectedPlan.root.annotations,
            title: collectedPlan.root.title
        },
        startedAt: runStartTimeFromMilliseconds(startedAtMilliseconds)
    });
}

async function reportResultWithDelivery(
    result: RunResult,
    reporterDelivery: ReporterDelivery
): Promise<RunResult> {
    const runEndErrors = await reporterDelivery.reportEvent({ kind: 'run-end', result });
    const resultForFinalReporting = appendRunnerErrors(result, runEndErrors);
    const finalReporterErrors = await reporterDelivery.reportResult(resultForFinalReporting);
    const disposeErrors = await reporterDelivery.disposeReporters();

    return appendRunnerErrors(resultForFinalReporting, [ ...finalReporterErrors, ...disposeErrors ]);
}

async function reportFinalResult(result: RunResult, runtime: WorkerPoolRunRuntime): Promise<RunResult> {
    return await reportResultWithDelivery(result, runtime.reporterDelivery);
}

export async function finishWorkerPoolRun(
    runtime: WorkerPoolRunRuntime,
    completedTaskRuns: readonly WorkerPoolTaskRun[],
    startedAtMicroseconds: number
): Promise<RunResult> {
    await runtime.reporterEvents.wait();
    const perTest = orderedPerTest(
        runtime.collectedPlan,
        [
            ...completedTaskRuns
                .filter(function includesPerTest(taskRun) {
                    return taskRun.includeArtifacts.read();
                })
                .flatMap(function toPerTest(taskRun) {
                    return taskRun.state.perTestResults();
                }),
            ...runtime.taskResults.flatMap(function toPerTest(result) {
                return result.perTest;
            })
        ]
    );
    const result = resultWithArtifacts(
        createRunResultFromCollectedPlan(
            runtime.collectedPlan,
            perTest,
            allTaskErrors(runtime, completedTaskRuns),
            {
                completedAtMicroseconds: runtime.dependencies.wallClock.currentMonotonicMicroseconds,
                planStatus: 'planned',
                resourceUsage: finishPoolResourceUsage(runtime),
                startedAtMicroseconds,
                testExecutionWallTimeMicroseconds: Math.max(
                    runtime.runState.testExecutionWallTimeMicroseconds(),
                    ...completedTaskRuns.map(function toExecutionTime(taskRun) {
                        return taskRun.state.testExecutionWallTimeMicroseconds();
                    })
                )
            }
        ),
        [ ...runtime.runState.artifacts(), ...allTaskArtifacts(completedTaskRuns), ...taskArtifacts(runtime) ]
    );

    return await reportFinalResult(await runtime.finalizeResult(result), runtime);
}

export async function createEmptyWorkerPoolResult(
    resolvedRun: WorkerPoolRunRuntime['resolvedRun'],
    dependencies: RunOrchestratorDependencies,
    collectionRunState: SupervisedRunState
): Promise<RunResult> {
    const reporterDelivery = await createReporterDelivery(resolvedRun, dependencies);
    const startedAtMilliseconds = dependencies.wallClock.currentEpochMilliseconds;
    const startedAtMicroseconds = dependencies.wallClock.currentMonotonicMicroseconds;
    const collectedPlan = workerPoolCollectedPlan(resolvedRun);
    const runStartErrors = await reportEmptyShardRunStart(
        reporterDelivery,
        resolvedRun,
        collectedPlan,
        startedAtMilliseconds
    );
    const result = resultWithArtifacts(
        createRunResultFromCollectedPlan(
            collectedPlan,
            [],
            [ ...resolvedRun.collectionRunnerErrors, ...collectionRunState.runnerErrors(), ...runStartErrors ],
            {
                completedAtMicroseconds: dependencies.wallClock.currentMonotonicMicroseconds,
                planStatus: emptyWorkerPoolPlanStatus(resolvedRun),
                resourceUsage: null,
                startedAtMicroseconds,
                testExecutionWallTimeMicroseconds: collectionRunState.testExecutionWallTimeMicroseconds()
            }
        ),
        collectionRunState.artifacts()
    );
    return await reportResultWithDelivery(result, reporterDelivery);
}
