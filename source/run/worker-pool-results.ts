import { caseIdentityKey } from '../engine/identity.ts';
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
    return completedTaskRuns.flatMap(function toArtifacts(taskRun) {
        return taskRun.state.artifacts();
    });
}

function allTaskErrors(
    runtime: WorkerPoolRunRuntime,
    completedTaskRuns: readonly WorkerPoolTaskRun[]
): readonly RunnerError[] {
    return [
        ...runtime.collectionRunnerErrors,
        ...runtime.runState.runnerErrors(),
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
        return [ caseIdentityKey(result.id), result ];
    }));

    return collectedRunCaseEntries(collectedPlan).flatMap(function toResult(entry) {
        const result = results.get(caseIdentityKey(entry.id));

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

async function reportFinalResult(result: RunResult, runtime: WorkerPoolRunRuntime): Promise<RunResult> {
    const runEndErrors = await runtime.reporterDelivery.reportEvent({ kind: 'run-end', result });
    const resultForFinalReporting = {
        ...result,
        runnerErrors: [ ...result.runnerErrors, ...runEndErrors ]
    };
    const finalReporterErrors = await runtime.reporterDelivery.reportResult(resultForFinalReporting);
    const disposeErrors = await runtime.reporterDelivery.disposeReporters();

    return {
        ...resultForFinalReporting,
        runnerErrors: [ ...resultForFinalReporting.runnerErrors, ...finalReporterErrors, ...disposeErrors ]
    };
}

export async function finishWorkerPoolRun(
    runtime: WorkerPoolRunRuntime,
    completedTaskRuns: readonly WorkerPoolTaskRun[],
    startedAtMilliseconds: number
): Promise<RunResult> {
    await runtime.reporterEvents.wait();
    const perTest = orderedPerTest(
        runtime.collectedPlan,
        [
            ...completedTaskRuns.flatMap(function toPerTest(taskRun) {
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
                resourceUsage: finishPoolResourceUsage(runtime),
                startedAtMs: startedAtMilliseconds,
                wallClock: runtime.dependencies.wallClock
            }
        ),
        [ ...runtime.runState.artifacts(), ...allTaskArtifacts(completedTaskRuns), ...taskArtifacts(runtime) ]
    );

    return await reportFinalResult(result, runtime);
}

export async function createEmptyWorkerPoolResult(
    resolvedRun: WorkerPoolRunRuntime['resolvedRun'],
    dependencies: RunOrchestratorDependencies,
    collectionRunState: SupervisedRunState
): Promise<RunResult> {
    const reporterDelivery = await createReporterDelivery(resolvedRun, dependencies);
    const startedAtMilliseconds = dependencies.wallClock.currentTimestampInMilliseconds;
    const result = resultWithArtifacts(
        createRunResultFromCollectedPlan(
            workerPoolCollectedPlan(resolvedRun),
            [],
            [ ...resolvedRun.collectionRunnerErrors, ...collectionRunState.runnerErrors() ],
            {
                resourceUsage: null,
                startedAtMs: startedAtMilliseconds,
                wallClock: dependencies.wallClock
            }
        ),
        collectionRunState.artifacts()
    );
    const runEndErrors = await reporterDelivery.reportEvent({ kind: 'run-end', result });
    const resultForFinalReporting = {
        ...result,
        runnerErrors: [ ...result.runnerErrors, ...runEndErrors ]
    };
    const finalReporterErrors = await reporterDelivery.reportResult(resultForFinalReporting);
    const disposeErrors = await reporterDelivery.disposeReporters();

    return {
        ...resultForFinalReporting,
        runnerErrors: [ ...resultForFinalReporting.runnerErrors, ...finalReporterErrors, ...disposeErrors ]
    };
}
