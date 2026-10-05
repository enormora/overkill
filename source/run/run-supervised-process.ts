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
import { finalizeSupervisedResult, type SupervisedCoverageExecution } from './run-supervised-finalization.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
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
type SupervisedExecution = SupervisedCoverageExecution & {
    readonly command: RunCommand;
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

async function runSupervisedExecution(execution: SupervisedExecution): Promise<RunResult> {
    const { command, coverageSession, dependencies, input, record, source, timing } = execution;
    const expectedDirectPlan = await createExpectedDirectEntrypointPlan(command, dependencies, input, source);

    return await runSupervisedCommand(
        createSupervisedRunCommand(command, input.profile, input.files, source),
        dependencies,
        async function createResolvedRunAfterCollection(collection): Promise<ResolvedRun> {
            const run = await resolvedSupervisedExecution({
                allowEmptySelection: true,
                collection,
                command,
                dependencies,
                expectedDirectPlan,
                input
            });
            await record?.recordFacts(run.facts);

            return run;
        },
        {
            coverage: coverageSession?.childProcess ?? null,
            async finalizeResult(resolvedRun, result) {
                return await finalizeSupervisedResult(resolvedRun, result, execution);
            },
            timing
        }
    );
}

async function runStartedSupervisedExecution(execution: StartedSupervisedExecution): Promise<RunResult> {
    const { command, dependencies, input, source, timing } = execution;
    if (!command.request.coverage) {
        return await runSupervisedExecution({
            command,
            coverageSession: null,
            dependencies,
            input,
            record: null,
            source,
            timing
        });
    }

    const { runRecordedCoverage } = await import('./recorded-coverage-run.ts');

    return await runRecordedCoverage({
        command,
        dependencies,
        async execute({ record, session }) {
            return await runSupervisedExecution({
                command,
                coverageSession: session,
                dependencies,
                input,
                record,
                source,
                timing
            });
        },
        input,
        timing
    });
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
