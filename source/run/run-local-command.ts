import { executeWithRuntimeAttachments } from './runtime-attachment-boundary.ts';
import {
    createResultFromResolutionError,
    reportCollectionErrorResult
} from './run-collection-error-result.ts';
import { readResolvedRunInput } from './run-input-resolution.ts';
import { executeInProcessResolvedRun } from './run-in-process-execution.ts';
import {
    type LocalRunCollectionSource as RunCollectionSource,
    createLocalRunOrEmptySelectionResult
} from './run-local-resolution.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import {
    createRunRuntimePolicy,
    finalizeResultWithDurationHistory,
    type RunRuntimePolicy
} from './run-support.ts';
import { emptyTimingSpanMetadata, type RunTimingMeasurement } from './run-timing-collection.ts';
import type { ResolvedRun, RunCommand, RunOrchestrator } from './run-types.ts';

type RunResult = Awaited<ReturnType<RunOrchestrator['run']>>;
type LocalRunOptions = {
    readonly source: RunCollectionSource;
    readonly timing: RunTimingMeasurement;
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
    return await executeInProcessResolvedRun(resolvedRun, dependencies, {
        async finalizeResult(run, result) {
            return await finalizeResultWithDurationHistory(dependencies, run, result, timing);
        },
        runtimePolicy,
        timing
    });
}

async function runLocalWithPolicy(
    command: RunCommand,
    dependencies: RunOrchestratorDependencies,
    options: LocalRunOptions,
    runtimePolicy: RunRuntimePolicy | null
): Promise<RunResult> {
    const resolvedRun = await createLocalRunResult(command, dependencies, runtimePolicy, options);
    if (isRunResult(resolvedRun)) {
        const errors = runtimePolicy?.takeRunErrors() ?? [];
        return await reportCollectionErrorResult(command, dependencies, {
            ...resolvedRun,
            runnerErrors: [ ...resolvedRun.runnerErrors, ...errors ],
            status: errors.length > 0 ? 'failed' : resolvedRun.status
        }, options.timing);
    }
    return await executeWithRuntimeAttachments(resolvedRun, dependencies, async function executeAttachmentRun() {
        return await executeResolvedRun(resolvedRun, dependencies, runtimePolicy, options.timing);
    });
}

async function runOrdinaryLocalCommand(
    command: RunCommand,
    dependencies: RunOrchestratorDependencies,
    timing: RunTimingMeasurement,
    source: RunCollectionSource
): Promise<RunResult> {
    const runtimePolicy = createRunRuntimePolicy(command.request, dependencies);
    try {
        return await runLocalWithPolicy(command, dependencies, { source, timing }, runtimePolicy);
    } finally {
        runtimePolicy?.takeRunErrors();
    }
}

export async function runLocalCommand(
    command: RunCommand,
    dependencies: RunOrchestratorDependencies,
    timing: RunTimingMeasurement,
    source: RunCollectionSource
): Promise<RunResult> {
    if (command.request.coverage) {
        const input = await readResolvedRunInput(command, dependencies);
        const coverage = await import('./run-local-coverage.ts');
        return await coverage.createCoverageLocalRunResult({ command, dependencies, input, source, timing });
    }
    return await runOrdinaryLocalCommand(command, dependencies, timing, source);
}
