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
    assertExpectedDirectEntrypointCollection,
    createExpectedDirectEntrypointPlan,
    createWorkerPoolCommand,
    type IsolatedRunCollectionSource
} from './run-isolated-command.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import {
    finalizeResultWithDurationHistory,
    readRunDurationHistory,
    type RunRuntimePolicy
} from './run-support.ts';
import {
    executeSupervisedRun
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
import {
    createSupervisedResolvedRun,
    createSupervisedRunResult
} from './run-supervised-process.ts';

type RunResult = Awaited<ReturnType<RunOrchestrator['run']>>;
export type RunCollectionSource = IsolatedRunCollectionSource;
type RunTimingMeasurement = NonNullable<NonNullable<Parameters<RunOrchestrator['run']>[1]>['timing']>;
type CollectedExecution = {
    readonly collectedPlan: CollectedRunPlan;
    readonly runnerErrors: readonly RunResult['runnerErrors'][number][];
};
type IsolatedRunOptions = {
    readonly source: RunCollectionSource;
    readonly timing: RunTimingMeasurement | null;
};
const emptyCollectionTimingMetadata = Object.freeze({
    label: null,
    processId: null,
    resource: null,
    workerId: null
});

type ExecutionResolutionInput = {
    readonly allowEmptySelection: boolean;
    readonly collection: CollectedExecution;
    readonly command: RunCommand;
    readonly dependencies: RunOrchestratorDependencies;
    readonly durationHistoryIndex: CollectionDurationHistoryIndex;
    readonly expectedDirectPlan: Awaited<ReturnType<typeof createExpectedDirectEntrypointPlan>>;
    readonly input: ResolvedRunInput;
    readonly planKind: 'supervised' | 'worker-pool';
};

async function createResolvedExecutionRun(resolution: ExecutionResolutionInput): Promise<ResolvedRun> {
    if (resolution.expectedDirectPlan !== null) {
        assertExpectedDirectEntrypointCollection(
            resolution.expectedDirectPlan,
            resolution.collection.collectedPlan
        );
    }

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
    input: ResolvedRunInput,
    options: IsolatedRunOptions
): Promise<ResolvedRun> {
    const expected = options.source.kind === 'direct-entrypoint'
        ? await createExpectedDirectEntrypointPlan(command, dependencies, input, options.source)
        : null;
    const collection = await (options.timing?.measureAsync(
        'collection.import',
        emptyCollectionTimingMetadata,
        async function collectTimedWorkerPoolRun() {
            return await collectWorkerPoolRun(
                createWorkerPoolCommand({
                    command,
                    definitionLocationCapture: 'enabled',
                    files: input.files,
                    profile: input.profile,
                    source: options.source
                }),
                dependencies,
                options.timing
            );
        }
    ) ?? collectWorkerPoolRun(
        createWorkerPoolCommand({
            command,
            definitionLocationCapture: 'enabled',
            files: input.files,
            profile: input.profile,
            source: options.source
        }),
        dependencies,
        null
    ));
    const durationHistoryIndex = await readWorkerPoolDurationHistory(input, dependencies);

    return await createResolvedExecutionRun({
        allowEmptySelection: false,
        collection,
        command,
        dependencies,
        durationHistoryIndex,
        expectedDirectPlan: expected,
        input,
        planKind: 'worker-pool'
    });
}

export function createIsolatedResolvedRun(
    command: RunCommand,
    dependencies: RunOrchestratorDependencies,
    input: ResolvedRunInput,
    options: IsolatedRunOptions
): Promise<ResolvedRun> | null {
    if (input.profile.execution.processModel === 'supervised-process') {
        return createSupervisedResolvedRun({
            command,
            dependencies,
            input,
            source: options.source,
            timing: options.timing
        });
    }

    if (input.profile.execution.processModel === 'worker-pool') {
        return createWorkerPoolResolvedRun(command, dependencies, input, options);
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

type WorkerPoolRunResultInput = {
    readonly command: RunCommand;
    readonly dependencies: RunOrchestratorDependencies;
    readonly input: ResolvedRunInput;
    readonly source: RunCollectionSource;
    readonly timing: RunTimingMeasurement | null;
};

async function executeWorkerPoolRunResult(options: WorkerPoolRunResultInput): Promise<RunResult> {
    const { command, dependencies, input, source, timing } = options;
    const expected = source.kind === 'direct-entrypoint'
        ? await createExpectedDirectEntrypointPlan(command, dependencies, input, source)
        : null;
    const durationHistoryIndex = await readWorkerPoolDurationHistory(input, dependencies);

    return await runWorkerPoolCommand(
        createWorkerPoolCommand({
            command,
            definitionLocationCapture: source.kind === 'direct-entrypoint' ? 'enabled' : 'disabled',
            files: input.files,
            profile: input.profile,
            source
        }),
        dependencies,
        async function createResolvedRunAfterCollection(collection): Promise<ResolvedRun> {
            return await createResolvedExecutionRun({
                allowEmptySelection: true,
                collection,
                command,
                dependencies,
                durationHistoryIndex,
                expectedDirectPlan: expected,
                input,
                planKind: 'worker-pool'
            });
        },
        {
            async finalizeResult(resolvedRun, completion) {
                return await finalizeResultWithDurationHistory(
                    dependencies,
                    resolvedRun,
                    completion.result,
                    timing
                );
            },
            timing
        }
    );
}

async function createWorkerPoolRunResult(
    command: RunCommand,
    dependencies: RunOrchestratorDependencies,
    timing: RunTimingMeasurement | null,
    source: RunCollectionSource
): Promise<RunResult> {
    const input = await readResolvedRunInput(command, dependencies);

    if (input.profile.execution.processModel !== 'worker-pool') {
        throw new Error('Expected worker-pool profile.');
    }

    try {
        return await executeWorkerPoolRunResult({ command, dependencies, input, source, timing });
    } catch (error: unknown) {
        return await reportCollectionErrorResult(
            command,
            dependencies,
            createResultFromResolutionError(error, null),
            timing
        );
    }
}

export function runIsolatedProcessCommand(
    command: RunCommand,
    dependencies: RunOrchestratorDependencies,
    options: IsolatedRunOptions
): Promise<RunResult> | null {
    const processModel = command.config.profiles[command.request.profile]?.execution.processModel;

    if (processModel === 'supervised-process') {
        return createSupervisedRunResult(command, dependencies, options.timing, options.source);
    }

    if (processModel === 'worker-pool') {
        return createWorkerPoolRunResult(command, dependencies, options.timing, options.source);
    }

    return null;
}

export async function executeNonLocalResolvedRun(
    resolvedRun: ResolvedRun,
    dependencies: RunOrchestratorDependencies,
    runtimePolicy: RunRuntimePolicy | null,
    timing: RunTimingMeasurement | null = null
): Promise<RunResult | null> {
    if (resolvedRun.facts.execution.processModel === 'supervised-process') {
        const result = await executeSupervisedRun(resolvedRun, dependencies, {
            coverage: null,
            async finalizeResult(supervisedRun, finalResult) {
                return await finalizeResultWithDurationHistory(dependencies, supervisedRun, finalResult, timing);
            },
            timing
        });

        return addRunnerErrors(result, runtimePolicy?.takeRunErrors() ?? []);
    }

    if (resolvedRun.facts.execution.processModel === 'worker-pool') {
        return await executeWorkerPoolRun(resolvedRun, dependencies, {
            async finalizeResult(workerPoolRun, completion) {
                return await finalizeResultWithDurationHistory(dependencies, workerPoolRun, completion.result, timing);
            },
            timing
        });
    }

    return null;
}
