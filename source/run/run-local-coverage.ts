import { finalizeRunResult } from './run-result-finalization.ts';
import { createResultFromResolutionError, reportCollectionErrorResult } from './run-collection-error-result.ts';
import type { RecordedCoverageExecution, RecordedCoverageRequest } from './recorded-coverage-types.ts';
import { executeInProcessResolvedRun } from './run-in-process-execution.ts';
import {
    createLocalRunOrEmptySelectionResultFromInput,
    type LocalRunCollectionSource as RunCollectionSource
} from './run-local-resolution.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import { observeRunRuntimePolicy, type RunRuntimePolicy, type RunResultSession } from './run-support.ts';
import { emptyTimingSpanMetadata, type RunTimingMeasurement } from './run-timing-collection.ts';
import type { ResolvedRun, RunCommand } from './run-types.ts';

type RunResult = Awaited<ReturnType<RunOrchestratorDependencies['execute']>>;
type ActiveCoverageSession = RecordedCoverageExecution['session'];
type CoveredResolution = Awaited<ReturnType<typeof createLocalRunOrEmptySelectionResultFromInput>>;
type CoverageLocalExecution = {
    readonly baseline: RunResultSession | null;
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
    await resolution.record.recordFacts(resolved.facts, resolved.replayPlan);
    return resolved.run;
}

async function reportUnexecutedCoverageRun(
    execution: CoverageLocalExecution,
    result: RunResult
): Promise<RunResult> {
    const prepared = execution.baseline?.prepareResult(result) ?? result;
    const covered = await execution.session.finalize(prepared);
    const checkpoint = await execution.record.checkpointResult(covered);
    const finalResult = execution.baseline === null ? checkpoint : await execution.baseline.finalize(checkpoint);
    return await reportCollectionErrorResult(execution.command, execution.dependencies, finalResult, {
        timing: execution.timing,
        benchmarkHost: null
    });
}

async function executeCoveredWithPolicy(
    execution: CoverageLocalExecution,
    runtimePolicy: RunRuntimePolicy | null
): Promise<RunResult> {
    const { command, dependencies, input, record, session, source, timing } = execution;
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
        const errors = runtimePolicy?.takeRunErrors() ?? [];
        return await reportUnexecutedCoverageRun(execution, {
            ...resolvedRun,
            runnerErrors: [ ...resolvedRun.runnerErrors, ...errors ],
            status: errors.length > 0 ? 'failed' : resolvedRun.status
        });
    }

    return await executeInProcessResolvedRun(resolvedRun, dependencies, {
        async finalizeResult(run, result) {
            return await finalizeRunResult(run, result, {
                baseline: execution.baseline,
                coverageSession: session,
                record,
                dependencies,
                timing
            });
        },
        runtimePolicy,
        timing
    });
}

export async function executeCoverageLocalRun(execution: CoverageLocalExecution): Promise<RunResult> {
    return await observeRunRuntimePolicy(
        execution.command.request,
        execution.dependencies,
        async function executeObservedCoverage(runtimePolicy) {
            return await executeCoveredWithPolicy(execution, runtimePolicy);
        }
    );
}

type CoverageLocalCommand = Pick<
    CoverageLocalExecution,
    'baseline' | 'command' | 'dependencies' | 'input' | 'source' | 'timing'
>;

export async function createCoverageLocalRunResult(request: CoverageLocalCommand): Promise<RunResult> {
    const { baseline, command, dependencies, input, source, timing } = request;
    const { runRecordedCoverage } = await import('./recorded-coverage-run.ts');

    return await runRecordedCoverage({
        command,
        dependencies,
        async execute({ record, session }) {
            return await executeCoverageLocalRun({
                baseline,
                command,
                dependencies,
                input,
                record,
                session,
                source,
                timing
            });
        },
        input,
        timing
    });
}
