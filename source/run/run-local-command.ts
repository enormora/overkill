import { analysisSignal, withAnalysisSignal } from './analysis-deadline.ts';
import { isAnalysisFamilyPlan, observeResolvedFamily } from './family-profile-run.ts';
import { executeWithRuntimeAttachments, preparePropertyAttachments } from './runtime-attachment-boundary.ts';
import {
    reportCollectionErrorResult
} from './run-collection-error-result.ts';
import { executeLocalRun } from './run-in-process-execution.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import {
    observeRunRuntimePolicy,
    type RunRuntimePolicy
} from './run-support.ts';
import type { ResolvedRun, RunCommand } from './run-types.ts';
import { createLocalRunResult, isRunResult, type LocalRunOptions } from './local-run-collection.ts';

type RunResult = Awaited<ReturnType<RunOrchestratorDependencies['execute']>>;
async function executeCollectedRun(
    run: ResolvedRun,
    dependencies: RunOrchestratorDependencies,
    runtimePolicy: RunRuntimePolicy | null,
    options: LocalRunOptions
): Promise<RunResult> {
    if (isAnalysisFamilyPlan(run.plan)) {
        return await executeLocalRun(run, dependencies, runtimePolicy, options);
    }
    return await executeWithRuntimeAttachments(run, dependencies, async function executeAttachmentRun() {
        return await executeLocalRun(run, dependencies, runtimePolicy, options);
    }, options.record);
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
    return await observeResolvedFamily(resolvedRun, async function executeFamilyRun() {
        return await executeCollectedRun(resolvedRun, dependencies, runtimePolicy, options);
    });
}

async function runOrdinaryLocalCommand(
    command: RunCommand,
    dependencies: RunOrchestratorDependencies,
    options: LocalRunOptions
): Promise<RunResult> {
    if (command.config.profiles[command.request.profile]?.testFamily === 'property') {
        await preparePropertyAttachments();
    }
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
    options: LocalRunOptions,
    signal: Readonly<AbortSignal> | null = null
): Promise<RunResult> {
    if (command.request.coverage) {
        const coverage = await import('./run-local-coverage.ts');
        return await coverage.createCoverageLocalRunResult({ command, dependencies, ...options });
    }
    return await withAnalysisSignal(signal ?? analysisSignal(), async function runWithCancellation() {
        return await runOrdinaryLocalCommand(command, dependencies, options);
    });
}
