import { appendRunnerErrors } from '../engine/execution-result.ts';
import { workIdentityKey } from '../engine/identity.ts';
import { executeAdapterPlan, isAdapterPlan } from './adapter-execution.ts';
import { reportResultWithDelivery } from './run-result-reporting.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import type { ResolvedRun, RunnerResult } from './run-types.ts';
import { runnerResult } from './runner-result.ts';
import type { ReporterDelivery, RunResult, RunnerError, TestPlan, PerTestResult } from './run-engine-primitives.ts';

type AdapterProfile = Extract<ResolvedRun['config']['profiles'][string], { readonly testFamily: 'type-test'; }>;
type AdapterExecutionOptions = {
    readonly finalizeResult: (run: ResolvedRun, result: RunResult) => Promise<RunResult>;
};
type AdapterReporting = {
    readonly run: ResolvedRun;
    readonly plan: TestPlan;
    readonly delivery: ReporterDelivery;
    readonly options: AdapterExecutionOptions;
};

async function reportCase(
    delivery: ReporterDelivery,
    plan: TestPlan,
    result: PerTestResult
): Promise<readonly RunnerError[]> {
    const testCase = plan.cases.find(function sameWork(entry) {
        return workIdentityKey(entry.workId) === workIdentityKey(result.workId);
    });
    if (testCase === undefined) {
        throw new Error('Adapter returned an unknown work identity.');
    }
    const metadata = {
        case: result.id,
        workId: result.workId,
        definitionLocations: result.definitionLocations,
        suitePath: testCase.suitePath,
        attempt: 0
    };
    const startErrors = await delivery.reportEvent({ kind: 'test-start', ...metadata });
    const endErrors = await delivery.reportEvent({
        kind: 'test-end',
        ...metadata,
        completion: 'final',
        artifacts: [],
        property: null,
        benchmark: null,
        outcome: result.outcome,
        verdict: result.verdict,
        durationMicroseconds: result.durationMicroseconds
    });
    return [ ...startErrors, ...endErrors ];
}

async function reportAdapterResult(context: AdapterReporting, result: RunResult): Promise<RunnerResult> {
    const errors: RunnerError[] = [];
    for (const testResult of result.perTest) {
        errors.push(...await reportCase(context.delivery, context.plan, testResult));
    }
    const final = await context.options.finalizeResult(context.run, appendRunnerErrors(result, errors));
    return runnerResult(await reportResultWithDelivery(final, context.delivery));
}

async function executeReportedAdapter(context: AdapterReporting, profile: AdapterProfile): Promise<RunnerResult> {
    const startedAt = new Date();
    const errors = await context.delivery.reportEvent({
        kind: 'run-start',
        facts: context.run.facts,
        root: context.plan.root,
        startedAt: startedAt.toISOString()
    });
    if (!isAdapterPlan(context.run.plan)) {
        throw new Error('Adapter execution requires collected preparation.');
    }
    const result = await executeAdapterPlan(profile.adapter, context.run.plan.adapter.collected, context.plan);
    return await reportAdapterResult(context, appendRunnerErrors(result, errors));
}

export async function executeAdapterResolvedRun(
    run: ResolvedRun,
    profile: AdapterProfile,
    dependencies: RunOrchestratorDependencies,
    options: AdapterExecutionOptions
): Promise<RunnerResult> {
    if (run.plan.kind !== 'local') {
        throw new Error('Adapter execution requires a local plan.');
    }
    const delivery = await dependencies.reporterDispatcher.createDelivery(run.reporters, run.config.outputRenderer);
    try {
        return await executeReportedAdapter({ run, plan: run.plan.testPlan, delivery, options }, profile);
    } catch (error: unknown) {
        const cleanup = await delivery.disposeReporters();
        if (cleanup.length > 0) {
            throw new AggregateError([ error, ...cleanup ], 'Adapter execution and reporter cleanup failed.', {
                cause: error
            });
        }
        throw error;
    }
}
