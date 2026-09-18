import {
    createResultFromResolutionError,
    reportCollectionErrorResult
} from './run-collection-error-result.ts';
import {
    createResolvedRunFromCollection,
    type CollectionDurationHistoryIndex
} from './run-collected-resolution.ts';
import {
    readResolvedRunInput,
    type ResolvedRunInput
} from './run-input-resolution.ts';
import {
    createSupervisedCollectCommand,
    createSupervisedRunCommand,
    createWorkerPoolCommand
} from './run-isolated-command.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import {
    finalizeResultWithDurationHistory,
    readRunDurationHistory,
    type RunRuntimePolicy
} from './run-support.ts';
import {
    collectSupervisedRun,
    executeSupervisedRun,
    runSupervisedCommand
} from './supervised-run.ts';
import {
    collectWorkerPoolRun,
    executeWorkerPoolRun,
    runWorkerPoolCommand
} from './worker-pool-run.ts';
import type {
    CollectedRunPlan,
    ResolvedRun,
    RunCommand,
    RunOrchestrator
} from './run-types.ts';

type RunResult = Awaited<ReturnType<RunOrchestrator['run']>>;
type CollectedExecution = {
    readonly collectedPlan: CollectedRunPlan;
    readonly runnerErrors: readonly RunResult['runnerErrors'][number][];
};

type ExecutionResolutionInput = {
    readonly allowEmptySelection: boolean;
    readonly collection: CollectedExecution;
    readonly command: RunCommand;
    readonly dependencies: RunOrchestratorDependencies;
    readonly durationHistoryIndex: CollectionDurationHistoryIndex;
    readonly input: ResolvedRunInput;
    readonly planKind: 'supervised' | 'worker-pool';
};

async function createResolvedExecutionRun(resolution: ExecutionResolutionInput): Promise<ResolvedRun> {
    return await createResolvedRunFromCollection({
        allowEmptySelection: resolution.allowEmptySelection,
        collection: resolution.collection,
        command: resolution.command,
        config: resolution.input.config,
        dependencies: resolution.dependencies,
        durationHistoryIndex: resolution.durationHistoryIndex,
        engine: resolution.input.engine,
        files: resolution.input.files,
        planKind: resolution.planKind,
        profile: resolution.input.profile,
        projectRoot: resolution.input.projectRoot,
        request: resolution.input.request
    });
}

async function readWorkerPoolDurationHistory(
    input: ResolvedRunInput,
    dependencies: RunOrchestratorDependencies
): Promise<CollectionDurationHistoryIndex> {
    const durationHistoryEnabled = input.profile.execution.processModel === 'worker-pool' &&
        input.profile.execution.assignmentPolicy === 'duration-history-balanced';

    if (!durationHistoryEnabled) {
        return null;
    }

    return await readRunDurationHistory(
        dependencies,
        input.projectRoot,
        input.config.runtimeStateDir
    );
}

async function createWorkerPoolResolvedRun(
    command: RunCommand,
    dependencies: RunOrchestratorDependencies,
    input: ResolvedRunInput
): Promise<ResolvedRun> {
    const collection = await collectWorkerPoolRun(
        createWorkerPoolCommand(command, 'enabled', input.profile, input.files),
        dependencies
    );
    const durationHistoryIndex = await readWorkerPoolDurationHistory(input, dependencies);

    return await createResolvedExecutionRun({
        allowEmptySelection: false,
        collection,
        command,
        dependencies,
        durationHistoryIndex,
        input,
        planKind: 'worker-pool'
    });
}

async function createSupervisedResolvedRun(
    command: RunCommand,
    dependencies: RunOrchestratorDependencies,
    input: ResolvedRunInput
): Promise<ResolvedRun> {
    const collection = await collectSupervisedRun(
        createSupervisedCollectCommand(command, input.profile, input.files),
        dependencies
    );

    return await createResolvedExecutionRun({
        allowEmptySelection: false,
        collection,
        command,
        dependencies,
        durationHistoryIndex: null,
        input,
        planKind: 'supervised'
    });
}

export function createIsolatedResolvedRun(
    command: RunCommand,
    dependencies: RunOrchestratorDependencies,
    input: ResolvedRunInput
): Promise<ResolvedRun> | null {
    if (input.profile.execution.processModel === 'supervised-process') {
        return createSupervisedResolvedRun(command, dependencies, input);
    }

    if (input.profile.execution.processModel === 'worker-pool') {
        return createWorkerPoolResolvedRun(command, dependencies, input);
    }

    return null;
}

function addRunnerErrors(result: RunResult, runnerErrors: readonly RunResult['runnerErrors'][number][]): RunResult {
    if (runnerErrors.length === 0) {
        return result;
    }

    return {
        ...result,
        runnerErrors: [ ...runnerErrors, ...result.runnerErrors ],
        status: 'failed'
    };
}

async function createSupervisedRunResult(
    command: RunCommand,
    dependencies: RunOrchestratorDependencies
): Promise<RunResult> {
    const input = await readResolvedRunInput(command, dependencies);

    if (input.profile.execution.processModel !== 'supervised-process') {
        throw new Error('Expected supervised-process profile.');
    }

    try {
        return await runSupervisedCommand(
            createSupervisedRunCommand(command, input.profile, input.files),
            dependencies,
            async function createResolvedRunAfterCollection(collection): Promise<ResolvedRun> {
                return await createResolvedExecutionRun({
                    allowEmptySelection: true,
                    collection,
                    command,
                    dependencies,
                    durationHistoryIndex: null,
                    input,
                    planKind: 'supervised'
                });
            },
            {
                async finalizeResult(resolvedRun, result) {
                    return await finalizeResultWithDurationHistory(dependencies, resolvedRun, result);
                }
            }
        );
    } catch (error: unknown) {
        return await reportCollectionErrorResult(
            command,
            dependencies,
            createResultFromResolutionError(error, null)
        );
    }
}

async function createWorkerPoolRunResult(
    command: RunCommand,
    dependencies: RunOrchestratorDependencies
): Promise<RunResult> {
    const input = await readResolvedRunInput(command, dependencies);

    if (input.profile.execution.processModel !== 'worker-pool') {
        throw new Error('Expected worker-pool profile.');
    }

    try {
        const durationHistoryIndex = await readWorkerPoolDurationHistory(input, dependencies);

        return await runWorkerPoolCommand(
            createWorkerPoolCommand(command, 'disabled', input.profile, input.files),
            dependencies,
            async function createResolvedRunAfterCollection(collection): Promise<ResolvedRun> {
                return await createResolvedExecutionRun({
                    allowEmptySelection: true,
                    collection,
                    command,
                    dependencies,
                    durationHistoryIndex,
                    input,
                    planKind: 'worker-pool'
                });
            },
            {
                async finalizeResult(resolvedRun, result) {
                    return await finalizeResultWithDurationHistory(dependencies, resolvedRun, result);
                }
            }
        );
    } catch (error: unknown) {
        return await reportCollectionErrorResult(
            command,
            dependencies,
            createResultFromResolutionError(error, null)
        );
    }
}

export function runIsolatedProcessCommand(
    command: RunCommand,
    dependencies: RunOrchestratorDependencies
): Promise<RunResult> | null {
    const processModel = command.config.profiles[command.request.profile]?.execution.processModel;

    if (processModel === 'supervised-process') {
        return createSupervisedRunResult(command, dependencies);
    }

    if (processModel === 'worker-pool') {
        return createWorkerPoolRunResult(command, dependencies);
    }

    return null;
}

export async function executeNonLocalResolvedRun(
    resolvedRun: ResolvedRun,
    dependencies: RunOrchestratorDependencies,
    runtimePolicy: RunRuntimePolicy | null
): Promise<RunResult | null> {
    if (resolvedRun.facts.execution.processModel === 'supervised-process') {
        const result = await executeSupervisedRun(resolvedRun, dependencies, {
            async finalizeResult(supervisedRun, finalResult) {
                return await finalizeResultWithDurationHistory(dependencies, supervisedRun, finalResult);
            }
        });

        return addRunnerErrors(result, runtimePolicy?.takeRunErrors() ?? []);
    }

    if (resolvedRun.facts.execution.processModel === 'worker-pool') {
        return await executeWorkerPoolRun(resolvedRun, dependencies, {
            async finalizeResult(workerPoolRun, result) {
                return await finalizeResultWithDurationHistory(dependencies, workerPoolRun, result);
            }
        });
    }

    return null;
}
