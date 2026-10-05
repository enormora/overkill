import { createResultFromResolutionError, reportCollectionErrorResult } from './run-collection-error-result.ts';
import type { RecordedCoverageExecution, RecordedCoverageRequest } from './recorded-coverage-types.ts';
import { executeInProcessResolvedRun } from './run-in-process-execution.ts';
import type { RunCollectionSource } from './run-isolated-process.ts';
import { createLocalRunOrEmptySelectionResultFromInput } from './run-local-resolution.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import { createRunRuntimePolicy, finalizeResultWithDurationHistory, type RunRuntimePolicy } from './run-support.ts';
import { emptyTimingSpanMetadata, type RunTimingMeasurement } from './run-timing-collection.ts';
import type { ResolvedRun, RunCommand, RunOrchestrator } from './run-types.ts';

type RunResult = Awaited<ReturnType<RunOrchestrator['run']>>;
type ActiveCoverageSession = RecordedCoverageExecution['session'];
type CoveredResolution = Awaited<ReturnType<typeof createLocalRunOrEmptySelectionResultFromInput>>;
type CoverageLocalExecution = {
    readonly command: RunCommand;
    readonly dependencies: RunOrchestratorDependencies;
    readonly input: RecordedCoverageRequest['input'];
    readonly record: RecordedCoverageExecution['record'];
    readonly session: ActiveCoverageSession;
    readonly source: RunCollectionSource;
    readonly timing: RunTimingMeasurement;
};
type CoverageLocalResolution = {
    readonly command: RunCommand;
    readonly dependencies: RunOrchestratorDependencies;
    readonly input: RecordedCoverageRequest['input'];
    readonly record: RecordedCoverageExecution['record'];
    readonly runtimePolicy: RunRuntimePolicy | null;
    readonly source: RunCollectionSource;
    readonly timing: RunTimingMeasurement;
};
async function collectCoveredLocalRun(resolution: CoverageLocalResolution): Promise<CoveredResolution | RunResult> {
    const { command, dependencies, input, runtimePolicy, source, timing } = resolution;
    const collect = async function collectInsideRuntimePolicy(): Promise<CoveredResolution> {
        return await timing.measureAsync(
            'collection.resolve',
            emptyTimingSpanMetadata(),
            async function resolveCoveredLocalRun() {
                return await createLocalRunOrEmptySelectionResultFromInput(command, dependencies, input, source);
            }
        );
    };
    const collectWithPolicy = async function collectCoveredLocalRunWithPolicy(): Promise<CoveredResolution> {
        return runtimePolicy === null ? await collect() : await runtimePolicy.runLoad(collect);
    };
    try {
        return await collectWithPolicy();
    } catch (error: unknown) {
        return createResultFromResolutionError(error, runtimePolicy);
    }
}

function isRunResult(value: CoveredResolution | ResolvedRun | RunResult): value is RunResult {
    return Object.hasOwn(value, 'summary');
}

async function resolveCoverageLocalRun(resolution: CoverageLocalResolution): Promise<ResolvedRun | RunResult> {
    const resolved = await collectCoveredLocalRun(resolution);
    if (isRunResult(resolved)) {
        return resolved;
    }
    await resolution.record.recordFacts(resolved.facts);
    return resolved.run;
}

export async function executeCoverageLocalRun(execution: CoverageLocalExecution): Promise<RunResult> {
    const { command, dependencies, input, record, session, source, timing } = execution;
    const runtimePolicy = createRunRuntimePolicy(command.request, dependencies);
    const resolvedRun = await resolveCoverageLocalRun({
        command,
        dependencies,
        input,
        record,
        runtimePolicy,
        source,
        timing
    });

    if (isRunResult(resolvedRun)) {
        const finalResult = await session.finalize(resolvedRun);

        return await reportCollectionErrorResult(
            command,
            dependencies,
            await record.checkpointResult(finalResult),
            timing
        );
    }

    return await executeInProcessResolvedRun(resolvedRun, dependencies, {
        async finalizeResult(run, result) {
            const coverageResult = await session.finalize(result);

            return await record.checkpointResult(
                await finalizeResultWithDurationHistory(dependencies, run, coverageResult, timing)
            );
        },
        runtimePolicy,
        timing
    });
}

type CoverageLocalCommand = Pick<CoverageLocalExecution, 'command' | 'dependencies' | 'input' | 'source' | 'timing'>;

export async function createCoverageLocalRunResult(request: CoverageLocalCommand): Promise<RunResult> {
    const { command, dependencies, input, source, timing } = request;
    const { runRecordedCoverage } = await import('./recorded-coverage-run.ts');

    return await runRecordedCoverage({
        command,
        dependencies,
        async execute({ record, session }) {
            return await executeCoverageLocalRun({ command, dependencies, input, record, session, source, timing });
        },
        input,
        timing
    });
}
