import type { ProcessUsagePolicy } from '../config/types.ts';
import { resolveDebugSelection } from './run-debug.ts';
import { resolvedPropertyCorpus } from './property-corpus-execution.ts';
import { reporterWithAttachments } from './attachment-reporter.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import {
    hasPropertyReplay,
    createRunResourceRuntimePolicy,
    engineExecution,
    type ResolvedRunResultFinalizer,
    type RunRuntimePolicy
} from './run-support.ts';
import type { ResolvedRun } from './run-types.ts';
import type { RunTimingMeasurement } from './run-timing-collection.ts';
import { createResourceLifecycleTiming } from './resource-lifecycle-timing.ts';

type RunResult = Awaited<ReturnType<RunOrchestratorDependencies['execute']>>;
type RunProcessUsageTracker = ReturnType<RunOrchestratorDependencies['createProcessUsageTracker']>;
type LocalResolvedRun = ResolvedRun & {
    readonly plan: Extract<ResolvedRun['plan'], { readonly kind: 'local'; }>;
};

export type LocalExecutionOptions = {
    readonly finalizeResult: ResolvedRunResultFinalizer;
    readonly runtimePolicy: RunRuntimePolicy | null;
    readonly timing: RunTimingMeasurement | null;
};

function currentRunStartTime(dependencies: RunOrchestratorDependencies): string {
    const startedAt = new Date(dependencies.wallClock.currentUnixEpochMilliseconds);

    return startedAt.toISOString();
}

function createExecutionProcessUsageTracker(
    policy: ProcessUsagePolicy,
    dependencies: RunOrchestratorDependencies
): RunProcessUsageTracker | null {
    if (!policy.measure) {
        return null;
    }

    return dependencies.createProcessUsageTracker({
        samplingIntervalMilliseconds: policy.samplingIntervalMilliseconds
    });
}

export async function executeLocalResolvedRun(
    resolvedRun: LocalResolvedRun,
    dependencies: RunOrchestratorDependencies,
    options: LocalExecutionOptions
): Promise<RunResult> {
    const profile = resolvedRun.config.profiles[resolvedRun.request.profile];
    if (profile?.testFamily === 'type-test') {
        const { executeAdapterResolvedRun } = await import('./adapter-run.ts');
        return await executeAdapterResolvedRun(resolvedRun, profile, dependencies, options);
    }
    const { processUsagePolicy } = resolvedRun.facts.execution;
    const resourceTiming = options.timing === null
        ? null
        : createResourceLifecycleTiming({
            clock: dependencies.wallClock,
            processId: String(process.pid),
            target: { kind: 'parent', record: options.timing.record },
            workerId: null
        });

    const corpus = await resolvedPropertyCorpus(resolvedRun);
    return await dependencies.execute(resolvedRun.plan.testPlan, {
        debug: resolveDebugSelection(resolvedRun.request.debug, resolvedRun.plan.testPlan.cases),
        seed: BigInt(resolvedRun.facts.reproducibility.seed),
        execution: engineExecution(
            resolvedRun.facts.execution.scheduling,
            resolvedRun.facts.execution.maxConcurrency
        ),
        outputRenderer: resolvedRun.config.outputRenderer,
        async finalizeResult(result) {
            return await options.finalizeResult(resolvedRun, result);
        },
        reporters: resolvedRun.reporters.map(reporterWithAttachments),
        retryPolicy: resolvedRun.facts.execution.retries,
        processBudgets: processUsagePolicy.budgets,
        processUsageTracker: createExecutionProcessUsageTracker(processUsagePolicy, dependencies),
        runtimePolicy: createRunResourceRuntimePolicy(
            resolvedRun.plan.testPlan.cases,
            options.runtimePolicy,
            resourceTiming
        ),
        propertyRun: {
            ...hasPropertyReplay(resolvedRun.facts) ? { replay: resolvedRun.facts.propertyReplay } : {},
            corpus,
            seed: BigInt(resolvedRun.facts.reproducibility.seed),
            projectRoot: resolvedRun.facts.environment.projectRoot
        },
        failureArtifacts: resolvedRun.facts.execution.failureArtifacts,
        processUsageSamplingIntervalMilliseconds: resolvedRun
            .facts
            .execution
            .processUsagePolicy
            .samplingIntervalMilliseconds,
        runFacts: resolvedRun.facts,
        startedAt: currentRunStartTime(dependencies),
        timeoutPolicy: {
            hardTimeoutMilliseconds: resolvedRun.facts.execution.timeoutPolicy.hardMilliseconds,
            timeoutMilliseconds: resolvedRun.facts.execution.timeoutPolicy.softMilliseconds
        }
    });
}
