import type { ProcessUsagePolicy } from '../config/types.ts';
import {
    localFamilyOptions,
    isAnalysisFamilyRun,
    executeLocalFamily,
    type LocalResolvedRun,
    type LocalExecutionOptions
} from './family-profile-execution.ts';
import { resolveDebugSelection } from './run-debug.ts';
import { resolvedPropertyCorpus } from './property-corpus-execution.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import {
    hasPropertyReplay,
    createRunResourceRuntimePolicy,
    engineExecution
} from './run-support.ts';
import { createResourceLifecycleTiming } from './resource-lifecycle-timing.ts';

type RunResult = Awaited<ReturnType<RunOrchestratorDependencies['execute']>>;
type RunProcessUsageTracker = ReturnType<RunOrchestratorDependencies['createProcessUsageTracker']>;
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
    const common = localFamilyOptions(resolvedRun, dependencies, options);
    if (isAnalysisFamilyRun(resolvedRun)) {
        return await executeLocalFamily(resolvedRun, common, dependencies);
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
    const executionOptions = {
        ...common,
        debug: resolveDebugSelection(resolvedRun.request.debug, resolvedRun.plan.testPlan.cases),
        seed: BigInt(resolvedRun.facts.reproducibility.seed),
        execution: engineExecution(
            resolvedRun.facts.execution.scheduling,
            resolvedRun.facts.execution.maxConcurrency
        ),
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
        timeoutPolicy: {
            hardTimeoutMilliseconds: resolvedRun.facts.execution.timeoutPolicy.hardMilliseconds,
            timeoutMilliseconds: resolvedRun.facts.execution.timeoutPolicy.softMilliseconds
        }
    };
    return await executeLocalFamily(resolvedRun, executionOptions, dependencies);
}
