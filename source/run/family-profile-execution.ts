import { executePreparedFamilyWithDriver } from '../engine/engine.ts';
import type { FamilyExecuteOptions } from '../engine/family-run.ts';
import { withAnalysisDeadline } from './analysis-deadline.ts';
import type { LocalFamilyRunPlan } from './prepared-family-plan.ts';
import type { ResolvedRun } from './run-types.ts';
import { isFamilyPlan } from './family-profile-run.ts';
import { reporterWithAttachments } from './attachment-reporter.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';

import type { ResolvedRunResultFinalizer, RunRuntimePolicy } from './run-support.ts';
import type { RunTimingMeasurement } from './run-timing-collection.ts';

type RunResult = Awaited<ReturnType<RunOrchestratorDependencies['execute']>>;

export type LocalResolvedRun = ResolvedRun & {
    readonly plan: Extract<ResolvedRun['plan'], { readonly kind: 'local'; }>;
};
type FamilyResolvedRun = LocalResolvedRun & { readonly plan: LocalFamilyRunPlan; };
export type LocalExecutionOptions = {
    readonly finalizeResult: ResolvedRunResultFinalizer;
    readonly runtimePolicy: RunRuntimePolicy | null;
    readonly timing: RunTimingMeasurement | null;
};

export function localFamilyOptions(
    run: LocalResolvedRun,
    dependencies: RunOrchestratorDependencies,
    options: LocalExecutionOptions
): FamilyExecuteOptions {
    const controller = new AbortController();
    const startedAt = new Date(dependencies.wallClock.currentUnixEpochMilliseconds);
    return {
        signal: (isFamilyPlan(run.plan) ? run.plan.family.preparation : controller).signal,
        debug: { mode: 'off' },
        execution: { mode: 'serial-in-process' },
        retryPolicy: null,
        reporters: run.reporters.map(reporterWithAttachments),
        outputRenderer: run.config.outputRenderer,
        failureArtifacts: run.facts.execution.failureArtifacts,
        runFacts: run.facts,
        startedAt: startedAt.toISOString(),
        async finalizeResult(result) {
            return await options.finalizeResult(run, result);
        }
    };
}

export function isAnalysisFamilyRun(run: LocalResolvedRun): run is FamilyResolvedRun {
    return isFamilyPlan(run.plan) && run.plan.family.preparation.binding.testFamily.features.execution === 'analysis';
}

export async function executeLocalFamily(
    run: LocalResolvedRun,
    options: FamilyExecuteOptions,
    dependencies: RunOrchestratorDependencies
): Promise<RunResult> {
    if (isAnalysisFamilyRun(run)) {
        const { preparation, collected } = run.plan.family;
        return await withAnalysisDeadline(
            run.facts.execution.timeoutPolicy.softMilliseconds,
            'Analysis checking exceeded soft timeout.',
            async function check(signal) {
                return await executePreparedFamilyWithDriver(
                    preparation.engine,
                    collected,
                    { ...options, signal },
                    dependencies.execute
                );
            },
            dependencies.wallClock
        );
    }
    return isFamilyPlan(run.plan)
        ? await executePreparedFamilyWithDriver(
            run.plan.family.preparation.engine,
            run.plan.family.collected,
            options,
            dependencies.execute
        )
        : await dependencies.execute(run.plan.testPlan, options);
}
