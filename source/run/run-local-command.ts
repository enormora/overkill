import { executeWithRuntimeAttachments } from './runtime-attachment-boundary.ts';
import {
    reportCollectionErrorResult
} from './run-collection-error-result.ts';
import { executeInProcessResolvedRun } from './run-in-process-execution.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import {
    finalizeResultWithDurationHistory,
    observeRunRuntimePolicy,
    type RunRuntimePolicy
} from './run-support.ts';
import type { ResolvedRun, RunCommand } from './run-types.ts';
import { createLocalRunResult, isRunResult, type LocalRunOptions } from './local-run-collection.ts';

type RunResult = Awaited<ReturnType<RunOrchestratorDependencies['execute']>>;
async function executeResolvedRun(
    resolvedRun: ResolvedRun,
    dependencies: RunOrchestratorDependencies,
    runtimePolicy: RunRuntimePolicy | null,
    options: LocalRunOptions
): Promise<RunResult> {
    return await executeInProcessResolvedRun(resolvedRun, dependencies, {
        async finalizeResult(run, result) {
            const finalized = await finalizeResultWithDurationHistory(dependencies, run, result, options.timing);
            const checkpoint = options.record === null ? finalized : await options.record.checkpointResult(finalized);
            return options.baseline === null ? checkpoint : await options.baseline.finalize(checkpoint);
        },
        runtimePolicy,
        timing: options.timing
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
        const result = {
            ...resolvedRun,
            runnerErrors: [ ...resolvedRun.runnerErrors, ...errors ],
            status: errors.length > 0 ? 'failed' as const : resolvedRun.status
        };
        const checkpoint = options.record === null ? result : await options.record.checkpointResult(result);
        return await reportCollectionErrorResult(command, dependencies, checkpoint, {
            timing: options.timing,
            benchmarkHost: null
        });
    }
    return await executeWithRuntimeAttachments(resolvedRun, dependencies, async function executeAttachmentRun() {
        return await executeResolvedRun(resolvedRun, dependencies, runtimePolicy, options);
    }, options.record);
}

async function runOrdinaryLocalCommand(
    command: RunCommand,
    dependencies: RunOrchestratorDependencies,
    options: LocalRunOptions
): Promise<RunResult> {
    return await observeRunRuntimePolicy(
        command.request,
        dependencies,
        async function executeObservedRun(runtimePolicy) {
            return await runLocalWithPolicy(command, dependencies, options, runtimePolicy);
        }
    );
}

export async function runLocalCommand(
    command: RunCommand,
    dependencies: RunOrchestratorDependencies,
    options: LocalRunOptions
): Promise<RunResult> {
    if (command.request.coverage) {
        const coverage = await import('./run-local-coverage.ts');
        return await coverage.createCoverageLocalRunResult({ command, dependencies, ...options });
    }
    return await runOrdinaryLocalCommand(command, dependencies, options);
}
