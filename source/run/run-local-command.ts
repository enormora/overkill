import {
    createResultFromResolutionError,
    reportCollectionErrorResult
} from './run-collection-error-result.ts';
import { coverageExecutionCompleted, startCoverageSession } from './run-coverage.ts';
import { executeInProcessResolvedRun } from './run-in-process-execution.ts';
import {
    executeNonLocalResolvedRun,
    type RunCollectionSource
} from './run-isolated-process.ts';
import { readResolvedRunInput, type ResolvedRunInput } from './run-input-resolution.ts';
import {
    createLocalRunOrEmptySelectionResult,
    createLocalRunOrEmptySelectionResultFromInput
} from './run-local-resolution.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import {
    assertRunnableResourceUsagePolicy,
    createRunRuntimePolicy,
    finalizeResultWithDurationHistory,
    type RunRuntimePolicy
} from './run-support.ts';
import { emptyTimingSpanMetadata, type RunTimingMeasurement } from './run-timing-collection.ts';
import type { ResolvedRun, RunCommand, RunOrchestrator } from './run-types.ts';

type RunResult = Awaited<ReturnType<RunOrchestrator['run']>>;
type ActiveCoverageSession = Awaited<ReturnType<typeof startCoverageSession>>;
type LocalRunOptions = {
    readonly source: RunCollectionSource;
    readonly timing: RunTimingMeasurement;
};
type CoverageLocalExecution = {
    readonly command: RunCommand;
    readonly dependencies: RunOrchestratorDependencies;
    readonly input: ResolvedRunInput;
    readonly session: ActiveCoverageSession;
    readonly source: RunCollectionSource;
    readonly timing: RunTimingMeasurement;
};
type CoverageLocalResolution = {
    readonly command: RunCommand;
    readonly dependencies: RunOrchestratorDependencies;
    readonly input: ResolvedRunInput;
    readonly runtimePolicy: RunRuntimePolicy | null;
    readonly source: RunCollectionSource;
    readonly timing: RunTimingMeasurement;
};
type CoverageSessionStart = {
    readonly kind: 'error';
    readonly result: RunResult;
} | {
    readonly kind: 'started';
    readonly session: ActiveCoverageSession;
};

function isRunResult(value: ResolvedRun | RunResult): value is RunResult {
    return Object.hasOwn(value, 'summary');
}

async function resolveRunWithRuntimePolicy<RunValue>(
    resolveRun: () => Promise<RunValue>,
    runtimePolicy: RunRuntimePolicy | null
): Promise<RunValue> {
    return runtimePolicy === null ? await resolveRun() : await runtimePolicy.runLoad(resolveRun);
}

async function createLocalRunResult(
    command: RunCommand,
    dependencies: RunOrchestratorDependencies,
    runtimePolicy: RunRuntimePolicy | null,
    options: LocalRunOptions
): Promise<ResolvedRun | RunResult> {
    const resolveRun = async function resolveLocalRunInsidePolicy(): Promise<ResolvedRun | RunResult> {
        return await options.timing.measureAsync(
            'collection.resolve',
            emptyTimingSpanMetadata(),
            async function createTimedLocalRunOrEmptySelectionResult() {
                return await createLocalRunOrEmptySelectionResult(command, dependencies, options.source);
            }
        );
    };

    try {
        return await resolveRunWithRuntimePolicy(resolveRun, runtimePolicy);
    } catch (error: unknown) {
        try {
            return createResultFromResolutionError(error, runtimePolicy);
        } catch {
            runtimePolicy?.takeRunErrors();
            throw error;
        }
    }
}

async function executeResolvedRun(
    resolvedRun: ResolvedRun,
    dependencies: RunOrchestratorDependencies,
    runtimePolicy: RunRuntimePolicy | null,
    timing: RunTimingMeasurement
): Promise<RunResult> {
    assertRunnableResourceUsagePolicy(resolvedRun.facts.execution.resourceUsagePolicy);

    const nonLocalResult = await executeNonLocalResolvedRun(resolvedRun, dependencies, runtimePolicy, timing);

    if (nonLocalResult !== null) {
        return nonLocalResult;
    }

    return await executeInProcessResolvedRun(resolvedRun, dependencies, {
        async finalizeResult(run, result) {
            return await finalizeResultWithDurationHistory(dependencies, run, result, timing);
        },
        runtimePolicy,
        timing
    });
}

async function resolveCoverageLocalRun(resolution: CoverageLocalResolution): Promise<ResolvedRun | RunResult> {
    const { command, dependencies, input, runtimePolicy, source, timing } = resolution;

    try {
        return await resolveRunWithRuntimePolicy(async function resolveCoveredLocalRun() {
            return await timing.measureAsync(
                'collection.resolve',
                emptyTimingSpanMetadata(),
                async function createCoveredLocalRun() {
                    return await createLocalRunOrEmptySelectionResultFromInput(
                        command,
                        dependencies,
                        input,
                        source
                    );
                }
            );
        }, runtimePolicy);
    } catch (error: unknown) {
        return createResultFromResolutionError(error, runtimePolicy);
    }
}

async function executeCoverageLocalRun(execution: CoverageLocalExecution): Promise<RunResult> {
    const { command, dependencies, input, session, source, timing } = execution;
    const runtimePolicy = createRunRuntimePolicy(command.request, dependencies);
    const resolvedRun = await resolveCoverageLocalRun({
        command,
        dependencies,
        input,
        runtimePolicy,
        source,
        timing
    });

    if (isRunResult(resolvedRun)) {
        const finalResult = await session.finalize(resolvedRun, coverageExecutionCompleted(resolvedRun));

        return await reportCollectionErrorResult(command, dependencies, finalResult, timing);
    }

    return await executeInProcessResolvedRun(resolvedRun, dependencies, {
        async finalizeResult(run, result) {
            const coverageResult = await session.finalize(result, coverageExecutionCompleted(result));

            return await finalizeResultWithDurationHistory(dependencies, run, coverageResult, timing);
        },
        runtimePolicy,
        timing
    });
}

async function startLocalCoverageSession(
    command: RunCommand,
    dependencies: RunOrchestratorDependencies,
    input: ResolvedRunInput,
    timing: RunTimingMeasurement
): Promise<CoverageSessionStart> {
    try {
        const session = await startCoverageSession({
            processModel: 'in-process',
            projectRoot: input.projectRoot,
            runtimeStateDir: input.config.runtimeStateDir,
            testFiles: input.files.map(function testFilePath(file) {
                return file.file;
            }),
            timing
        });

        return { kind: 'started', session };
    } catch (error: unknown) {
        const result = await reportCollectionErrorResult(
            command,
            dependencies,
            createResultFromResolutionError(error, null),
            timing
        );

        return { kind: 'error', result };
    }
}

async function createCoverageLocalRunResult(
    command: RunCommand,
    dependencies: RunOrchestratorDependencies,
    timing: RunTimingMeasurement,
    source: RunCollectionSource
): Promise<RunResult> {
    const input = await readResolvedRunInput(command, dependencies);
    const sessionStart = await startLocalCoverageSession(command, dependencies, input, timing);

    if (sessionStart.kind === 'error') {
        return sessionStart.result;
    }

    try {
        return await executeCoverageLocalRun({
            command,
            dependencies,
            input,
            session: sessionStart.session,
            source,
            timing
        });
    } finally {
        await sessionStart.session.dispose();
    }
}

async function runOrdinaryLocalCommand(
    command: RunCommand,
    dependencies: RunOrchestratorDependencies,
    timing: RunTimingMeasurement,
    source: RunCollectionSource
): Promise<RunResult> {
    const runtimePolicy = createRunRuntimePolicy(command.request, dependencies);
    const resolvedRun = await createLocalRunResult(command, dependencies, runtimePolicy, { source, timing });

    if (isRunResult(resolvedRun)) {
        return await reportCollectionErrorResult(command, dependencies, resolvedRun, timing);
    }

    return await executeResolvedRun(resolvedRun, dependencies, runtimePolicy, timing);
}

export async function runLocalCommand(
    command: RunCommand,
    dependencies: RunOrchestratorDependencies,
    timing: RunTimingMeasurement,
    source: RunCollectionSource
): Promise<RunResult> {
    return command.request.coverage
        ? await createCoverageLocalRunResult(command, dependencies, timing, source)
        : await runOrdinaryLocalCommand(command, dependencies, timing, source);
}
