import {
    createResultFromResolutionError,
    reportCollectionErrorResult
} from './run-collection-error-result.ts';
import { createResolvedRunFromCollection } from './run-collected-resolution.ts';
import {
    readResolvedRunInput,
    type ResolvedRunInput
} from './run-input-resolution.ts';
import {
    assertExpectedDirectEntrypointCollection,
    createExpectedDirectEntrypointPlan,
    createSupervisedCollectCommand,
    createSupervisedRunCommand,
    type IsolatedRunCollectionSource
} from './run-isolated-command.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import { finalizeResultWithDurationHistory } from './run-support.ts';
import { collectSupervisedRun } from './supervised-run-collection.ts';
import {
    runSupervisedCommand
} from './supervised-run.ts';
import type {
    CollectedRunPlan,
    ResolvedRun,
    RunCommand,
    RunOrchestrator
} from './run-types.ts';

type RunResult = Awaited<ReturnType<RunOrchestrator['run']>>;
type RunTimingMeasurement = NonNullable<NonNullable<Parameters<RunOrchestrator['run']>[1]>['timing']>;
type SupervisedCoverageSession = {
    readonly childProcess: {
        readonly environment: {
            readonly NODE_DISABLE_COMPILE_CACHE: '1';
            readonly NODE_V8_COVERAGE: string;
        };
        readonly writablePath: string;
    } | null;
    readonly dispose: () => Promise<void>;
    readonly finalize: (result: RunResult, executionCompleted: boolean) => Promise<RunResult>;
};
type SupervisedExecution = {
    readonly command: RunCommand;
    readonly coverageSession: SupervisedCoverageSession | null;
    readonly dependencies: RunOrchestratorDependencies;
    readonly input: ResolvedRunInput;
    readonly source: IsolatedRunCollectionSource;
    readonly timing: RunTimingMeasurement | null;
};
type StartedSupervisedExecution = {
    readonly command: RunCommand;
    readonly dependencies: RunOrchestratorDependencies;
    readonly input: ResolvedRunInput;
    readonly source: IsolatedRunCollectionSource;
    readonly timing: RunTimingMeasurement | null;
};
type CollectedExecution = {
    readonly collectedPlan: CollectedRunPlan;
    readonly runnerErrors: readonly RunResult['runnerErrors'][number][];
};
type SupervisedResolution = {
    readonly allowEmptySelection: boolean;
    readonly collection: CollectedExecution;
    readonly command: RunCommand;
    readonly dependencies: RunOrchestratorDependencies;
    readonly expectedDirectPlan: Awaited<ReturnType<typeof createExpectedDirectEntrypointPlan>>;
    readonly input: ResolvedRunInput;
};
type SupervisedResolvedRunRequest = {
    readonly command: RunCommand;
    readonly dependencies: RunOrchestratorDependencies;
    readonly input: ResolvedRunInput;
    readonly source: IsolatedRunCollectionSource;
    readonly timing: RunTimingMeasurement | null;
};

const emptyCollectionTimingMetadata = Object.freeze({
    label: null,
    processId: null,
    resource: null,
    workerId: null
});

async function resolvedSupervisedExecution(resolution: SupervisedResolution): Promise<ResolvedRun> {
    const { allowEmptySelection, collection, command, dependencies, expectedDirectPlan, input } = resolution;

    assertExpectedDirectEntrypointCollection(expectedDirectPlan, collection.collectedPlan);

    return await createResolvedRunFromCollection({
        allowEmptySelection,
        collection,
        command,
        config: input.config,
        dependencies,
        durationHistoryIndex: null,
        engine: input.engine,
        files: input.files,
        planKind: 'supervised',
        profile: input.profile,
        projectRoot: input.projectRoot,
        request: input.request
    });
}

export async function createSupervisedResolvedRun(
    request: SupervisedResolvedRunRequest
): Promise<ResolvedRun> {
    const { command, dependencies, input, source, timing } = request;
    const expectedDirectPlan = await createExpectedDirectEntrypointPlan(command, dependencies, input, source);
    const collection = await (timing?.measureAsync(
        'collection.import',
        emptyCollectionTimingMetadata,
        async function collectTimedSupervisedRun() {
            return await collectSupervisedRun(
                createSupervisedCollectCommand(command, input.profile, input.files, source),
                dependencies,
                timing
            );
        }
    ) ?? collectSupervisedRun(
        createSupervisedCollectCommand(command, input.profile, input.files, source),
        dependencies,
        null
    ));

    return await resolvedSupervisedExecution({
        allowEmptySelection: false,
        collection,
        command,
        dependencies,
        expectedDirectPlan,
        input
    });
}

async function startSupervisedCoverageSession(
    command: RunCommand,
    input: ResolvedRunInput,
    timing: RunTimingMeasurement | null
): Promise<SupervisedCoverageSession | null> {
    if (!command.request.coverage) {
        return null;
    }

    const coverage = await import('./run-coverage.ts');

    return await coverage.startCoverageSession({
        coverage: coverage.microtestCoveragePolicy(input.profile),
        processModel: 'supervised-process',
        projectRoot: input.projectRoot,
        runtimeStateDir: input.config.runtimeStateDir,
        testFiles: input.files.map(function testFilePath(file) {
            return file.file;
        }),
        timing
    });
}

async function coveredResult(session: SupervisedCoverageSession, result: RunResult): Promise<RunResult> {
    const coverage = await import('./run-coverage.ts');

    return await session.finalize(result, coverage.coverageExecutionCompleted(result));
}

async function runSupervisedExecution(execution: SupervisedExecution): Promise<RunResult> {
    const { command, coverageSession, dependencies, input, source, timing } = execution;
    const expectedDirectPlan = await createExpectedDirectEntrypointPlan(command, dependencies, input, source);

    return await runSupervisedCommand(
        createSupervisedRunCommand(command, input.profile, input.files, source),
        dependencies,
        async function createResolvedRunAfterCollection(collection): Promise<ResolvedRun> {
            return await resolvedSupervisedExecution({
                allowEmptySelection: true,
                collection,
                command,
                dependencies,
                expectedDirectPlan,
                input
            });
        },
        {
            coverage: coverageSession?.childProcess ?? null,
            async finalizeResult(resolvedRun, result) {
                const coverageResult = coverageSession === null
                    ? result
                    : await coveredResult(coverageSession, result);

                return await finalizeResultWithDurationHistory(
                    dependencies,
                    resolvedRun,
                    coverageResult,
                    timing
                );
            },
            timing
        }
    );
}

async function runStartedSupervisedExecution(execution: StartedSupervisedExecution): Promise<RunResult> {
    const { command, dependencies, input, source, timing } = execution;
    const coverageSession = await startSupervisedCoverageSession(command, input, timing);

    try {
        return await runSupervisedExecution({ command, coverageSession, dependencies, input, source, timing });
    } finally {
        await coverageSession?.dispose();
    }
}

export async function createSupervisedRunResult(
    command: RunCommand,
    dependencies: RunOrchestratorDependencies,
    timing: RunTimingMeasurement | null,
    source: IsolatedRunCollectionSource
): Promise<RunResult> {
    const input = await readResolvedRunInput(command, dependencies);

    try {
        return await runStartedSupervisedExecution({ command, dependencies, input, source, timing });
    } catch (error: unknown) {
        return await reportCollectionErrorResult(
            command,
            dependencies,
            createResultFromResolutionError(error, null),
            timing
        );
    }
}
