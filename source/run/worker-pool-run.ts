import { appendRunnerErrors } from '../engine/execution-result.ts';
import { lateAssertionDiagnosticId } from '../engine/assertion-lifetime.ts';
import { observeWorkerLateAssertions } from './worker-pool-late-assertions.ts';
import type { RunnerError } from './run-engine-primitives.ts';
import { currentResourceCheckBroker, withResourceCheckBroker } from './resource-check-broker.ts';
import {
    type RunAttachmentRecord,
    activeRuntimeAttachments,
    executeWithRuntimeAttachments
} from './runtime-attachment-boundary.ts';

import type {
    CreatedWorkerPool,
    RunOrchestratorDependencies
} from './run-orchestrator-dependencies.ts';
import {
    createSupervisedRunState,
    type SupervisedRunState
} from './supervised-run-state.ts';
import type {
    ResolvedRun
} from './run-types.ts';
import { collectInWorkerPool } from './worker-pool-collection.ts';
import {
    executeWorkerPoolUnits
} from './worker-pool-execution.ts';
import {
    reportRunStart,
    startPoolProcessUsageTracking
} from './worker-pool-process-usage-tracking.ts';
import type { WorkerPoolCommand } from './worker-pool-protocol.ts';
import {
    createEmptyWorkerPoolResult,
    finishWorkerPoolRun
} from './worker-pool-results.ts';
import {
    createWorkerPoolRuntime,
    createWorkerPoolPlacementTraceRecorder,
    workerPoolPlacementPlan,
    type WorkerPoolCollectionResult,
    type WorkerPoolRunCompletion,
    type WorkerPoolRuntimeInput
    // eslint-disable-next-line import/max-dependencies -- This orchestration boundary consumes the resource-check protocol directly.
} from './worker-pool-runtime.ts';

type RunResult = WorkerPoolRunCompletion['result'];

type RunResultFinalizer = (resolvedRun: ResolvedRun, completion: WorkerPoolRunCompletion) => Promise<RunResult>;
type RunTimingMeasurement = NonNullable<NonNullable<WorkerPoolRuntimeInput['timing']>>;
const emptyWorkerPoolTimingMetadata = Object.freeze({
    label: null,
    processId: null,
    resource: null,
    workerId: null
});

export type WorkerPoolExecutionOptions = {
    readonly record: RunAttachmentRecord;
    readonly finalizeResult: RunResultFinalizer;
    readonly timing: RunTimingMeasurement | null;
};

type WorkerPoolExecutionState = WorkerPoolExecutionOptions & {
    readonly collectionRunState: SupervisedRunState;
    readonly createdPool: CreatedWorkerPool | null;
};

type WorkerPoolRunRuntime = Awaited<ReturnType<typeof createWorkerPoolRuntime>>;

export async function collectWorkerPoolRun(
    command: WorkerPoolCommand,
    dependencies: RunOrchestratorDependencies,
    timing: RunTimingMeasurement | null = null
): Promise<WorkerPoolCollectionResult> {
    return await collectInWorkerPool({
        command,
        createdPool: null,
        dependencies,
        runState: createSupervisedRunState('first-failure-and-final', command.failureArtifacts.capturedOutputBytes),
        timing
    });
}

async function releaseRuntimePool(
    runtime: WorkerPoolRunRuntime
): Promise<void> {
    runtime.pool.setHostOutputSink?.(null);

    if (runtime.destroyPool) {
        await runtime.pool.destroy();
    }
}

async function releaseTimedRuntimePool(
    runtime: WorkerPoolRunRuntime,
    timing: RunTimingMeasurement | null
): Promise<void> {
    if (runtime.destroyPool) {
        await (timing?.measureAsync(
            'worker-pool.shutdown',
            emptyWorkerPoolTimingMetadata,
            async function releaseTimedWorkerPoolRuntime() {
                await releaseRuntimePool(runtime);
            }
        ) ?? releaseRuntimePool(runtime));
    } else {
        await releaseRuntimePool(runtime);
    }
}

async function finishExecution(
    runtime: WorkerPoolRunRuntime,
    resolvedRun: ResolvedRun,
    startedAtMilliseconds: number,
    startedAtMicroseconds: number
): Promise<RunResult> {
    await reportRunStart(runtime, startedAtMilliseconds);
    await startPoolProcessUsageTracking(runtime);

    return await finishWorkerPoolRun(
        runtime,
        await executeWorkerPoolUnits(runtime, workerPoolPlacementPlan(resolvedRun), startedAtMilliseconds),
        startedAtMicroseconds
    );
}

async function createRuntime(
    resolvedRun: ResolvedRun,
    dependencies: RunOrchestratorDependencies,
    state: WorkerPoolExecutionState
): Promise<WorkerPoolRunRuntime> {
    const runtime = await createWorkerPoolRuntime({
        attachments: activeRuntimeAttachments(),
        collectionRunnerErrors: resolvedRun.collectionRunnerErrors,
        createdPool: state.createdPool,
        dependencies,
        async finalizeResult(completion): Promise<RunResult> {
            return await state.finalizeResult(resolvedRun, completion);
        },
        resolvedRun,
        runState: state.collectionRunState,
        timing: state.timing
    });
    currentResourceCheckBroker()?.observe(function publishResourceCheckpoint(snapshot) {
        runtime.reporterEvents.add((async function deliverCheckpoint() {
            runtime.runState.recordRunnerErrors(
                await runtime.reporterDelivery.reportEvent({ kind: 'resource-check-progress', snapshot })
            );
        })());
    });
    state.record?.retainPlacementTrace({ entries: runtime.placementTrace.entries() });
    return runtime;
}

async function finishExecutionWithRuntime(
    resolvedRun: ResolvedRun,
    dependencies: RunOrchestratorDependencies,
    state: WorkerPoolExecutionState,
    runtime: WorkerPoolRunRuntime
): Promise<RunResult> {
    const startedAtMilliseconds = dependencies.wallClock.currentUnixEpochMilliseconds;
    const startedAtMicroseconds = Number(dependencies.wallClock.currentMonotonicMicroseconds);
    const readyAtMicroseconds = Number(dependencies.wallClock.currentMonotonicMicroseconds);

    state.timing?.record({
        completedAtMicroseconds: readyAtMicroseconds,
        kind: 'worker-pool.ready',
        metadata: emptyWorkerPoolTimingMetadata,
        startedAtMicroseconds: readyAtMicroseconds,
        status: 'success'
    });

    return await finishExecution(runtime, resolvedRun, startedAtMilliseconds, startedAtMicroseconds);
}

function appendNewLateAssertions(result: RunResult, errors: readonly RunnerError[]): RunResult {
    const known = new Set(result.runnerErrors.map(lateAssertionDiagnosticId));
    return appendRunnerErrors(
        result,
        errors.filter(function newDiagnostic(error) {
            const id = lateAssertionDiagnosticId(error);
            if (id === null || known.has(id)) {
                return false;
            }
            known.add(id);
            return true;
        })
    );
}

async function finishObservedRuntime(
    runtime: WorkerPoolRunRuntime,
    finish: () => Promise<RunResult>,
    timing: RunTimingMeasurement | null
): Promise<RunResult> {
    const lateAssertions = observeWorkerLateAssertions(runtime.lifecycle.token, function recordDiagnostic(error) {
        runtime.runState.recordRunnerError(error);
        runtime.reporterEvents.add((async function deliverDiagnostic() {
            runtime.runState.recordRunnerErrors(
                await runtime.reporterDelivery.reportEvent({ kind: 'runner-error', error })
            );
        })());
    });
    try {
        return await finish();
    } finally {
        try {
            await releaseTimedRuntimePool(runtime, timing);
        } finally {
            await lateAssertions.close();
        }
    }
}

async function executeWorkerPoolRunWithoutAttachments(
    resolvedRun: ResolvedRun,
    dependencies: RunOrchestratorDependencies,
    state: WorkerPoolExecutionState
): Promise<RunResult> {
    if (workerPoolPlacementPlan(resolvedRun).units.length === 0) {
        return await createEmptyWorkerPoolResult(
            resolvedRun,
            dependencies,
            state.collectionRunState,
            async function finalizeEmptyResult(result) {
                return await state.finalizeResult(resolvedRun, {
                    placementTrace: createWorkerPoolPlacementTraceRecorder().finish(),
                    result
                });
            }
        );
    }

    const runtime = await createRuntime(resolvedRun, dependencies, state);

    const result = await finishObservedRuntime(runtime, async function executeRuntime() {
        return await finishExecutionWithRuntime(resolvedRun, dependencies, state, runtime);
    }, state.timing);
    await runtime.reporterEvents.wait();
    return appendNewLateAssertions(result, [
        ...runtime.runState.runnerErrors(),
        ...runtime.pool.takeHostRunnerErrors?.() ?? []
    ]);
}

async function executeWorkerPoolRunWithState(
    resolvedRun: ResolvedRun,
    dependencies: RunOrchestratorDependencies,
    state: WorkerPoolExecutionState
): Promise<RunResult> {
    const executeObservedWorkers = async function executeObservedWorkers(): Promise<RunResult> {
        return await executeWithRuntimeAttachments(
            resolvedRun,
            dependencies,
            async function executeAttachmentWorkers() {
                return await executeWorkerPoolRunWithoutAttachments(resolvedRun, dependencies, state);
            },
            state.record ?? null
        );
    };
    const hasResources = resolvedRun.plan.kind !== 'local' &&
        resolvedRun.plan.collectedPlan.files.some(function resourceFile(file) {
            return file.cases.some(function resourceCase(testCase) {
                return testCase.resourceAttachments.resourceGraph.length > 0;
            });
        });
    return await (hasResources ? withResourceCheckBroker(executeObservedWorkers) : executeObservedWorkers());
}

export async function executeWorkerPoolRun(
    resolvedRun: ResolvedRun,
    dependencies: RunOrchestratorDependencies,
    options: WorkerPoolExecutionOptions
): Promise<RunResult> {
    return await executeWorkerPoolRunWithState(resolvedRun, dependencies, {
        ...options,
        collectionRunState: createSupervisedRunState(
            'first-failure-and-final',
            resolvedRun.facts.execution.failureArtifacts.capturedOutputBytes
        ),
        createdPool: null
    });
}

async function destroyCommandPool(
    pool: CreatedWorkerPool | null,
    timing: RunTimingMeasurement | null
): Promise<void> {
    if (pool !== null) {
        await (timing?.measureAsync(
            'worker-pool.shutdown',
            emptyWorkerPoolTimingMetadata,
            async function destroyTimedCollectionWorkerPool() {
                await pool.destroy();
            }
        ) ?? pool.destroy());
    }
}

function createHostedCommandPool(
    command: WorkerPoolCommand,
    dependencies: RunOrchestratorDependencies,
    timing: RunTimingMeasurement | null
): CreatedWorkerPool | null {
    const timingOption = timing === null ? {} : { timing };
    const poolOptions = {
        cwd: command.cwd,
        hostProcess: command.hostProcess,
        testFamily: command.testFamily,
        ...timingOption,
        workerCount: 1,
        workerLifecycle: command.workerLifecycle
    };
    return command.hostProcess.kind === 'child'
        ? timing?.measure(
            'worker-pool.start',
            emptyWorkerPoolTimingMetadata,
            function createTimedHostedWorkerPool() {
                return dependencies.createWorkerPool(poolOptions);
            }
        ) ?? dependencies.createWorkerPool(poolOptions)
        : null;
}

export async function runWorkerPoolCommand(
    command: WorkerPoolCommand,
    dependencies: RunOrchestratorDependencies,
    createResolvedRun: (collection: WorkerPoolCollectionResult) => Promise<ResolvedRun>,
    options: WorkerPoolExecutionOptions
): Promise<RunResult> {
    const collectionRunState = createSupervisedRunState(
        'first-failure-and-final',
        command.failureArtifacts.capturedOutputBytes
    );
    const pool = createHostedCommandPool(command, dependencies, options.timing);
    const result = await (async function runWithCollection(): Promise<RunResult> {
        try {
            const collection = await collectInWorkerPool({
                command,
                createdPool: pool,
                dependencies,
                runState: collectionRunState,
                timing: options.timing
            });
            return await executeWorkerPoolRunWithState(await createResolvedRun(collection), dependencies, {
                ...options,
                collectionRunState,
                createdPool: pool
            });
        } finally {
            await destroyCommandPool(pool, options.timing);
        }
    })();
    return appendNewLateAssertions(result, pool?.takeHostRunnerErrors?.() ?? []);
}
