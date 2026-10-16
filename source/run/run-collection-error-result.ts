import type { ReporterDelivery } from '../engine/reporter-dispatcher.ts';
import { runStatusFromSummary, type RunResult } from '../engine/run-result.ts';
import { summaryRunTimings } from '../engine/run-timings.ts';
import { RunCollectionError } from './run-errors.ts';
import { resolveTimingCollection } from './run-profile-facts.ts';
import { selectProfile } from './test-profile.ts';
import {
    resultWithTimingCollection,
    type RunTimingMeasurement
} from './run-timing-collection.ts';
import { resolveRunReporters, withRunErrorMetadata, type RunRuntimePolicy } from './run-support.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import type { RunCommand, RunFacts } from './run-types.ts';

function createCollectionErrorRunResult(
    error: RunCollectionError,
    runtimePolicyErrors: readonly RunResult['runnerErrors'][number][]
): RunResult {
    const runnerErrors = [ ...runtimePolicyErrors, ...error.runnerErrors() ];
    const summary = {
        crashed: 0,
        defined: 0,
        discovered: 0,
        failed: 0,
        inconclusive: 0,
        passed: 0,
        planned: 0,
        processExhausted: 0,
        runtimePolicy: 0,
        skipped: 0
    };

    return {
        artifacts: [],
        bySuite: {},
        orphans: [],
        perTest: [],
        planStatus: 'empty-selection',
        processUsage: null,
        runnerErrors,
        status: runStatusFromSummary(summary, runnerErrors),
        summary,
        timings: summaryRunTimings({
            testExecutionWallTimeMicroseconds: 0,
            totalWallTimeMicroseconds: 0
        })
    };
}

function appendRunnerErrors(result: RunResult, runnerErrors: readonly RunResult['runnerErrors'][number][]): RunResult {
    if (runnerErrors.length === 0) {
        return result;
    }

    const updatedRunnerErrors = [ ...result.runnerErrors, ...runnerErrors ];

    return {
        ...result,
        runnerErrors: updatedRunnerErrors,
        status: runStatusFromSummary(result.summary, updatedRunnerErrors)
    };
}

async function throwWithReporterCleanupErrors(
    error: unknown,
    reporterDelivery: ReporterDelivery
): Promise<never> {
    const disposeErrors = await reporterDelivery.disposeReporters();

    if (disposeErrors.length > 0) {
        throw new AggregateError(
            [ error, ...disposeErrors ],
            'Execution failed and reporter cleanup failed.',
            { cause: error }
        );
    }

    throw error;
}

async function reportRunnerErrorEvents(
    reporterDelivery: ReporterDelivery,
    runnerErrors: readonly RunResult['runnerErrors'][number][]
): Promise<readonly RunResult['runnerErrors'][number][]> {
    return await runnerErrors.reduce(
        async function reportRunnerError(previousErrors, error) {
            return [
                ...await previousErrors,
                ...await reporterDelivery.reportEvent({ error, kind: 'runner-error' })
            ];
        },
        Promise.resolve<readonly RunResult['runnerErrors'][number][]>([])
    );
}

export function createResultFromResolutionError(
    error: unknown,
    runtimePolicy: RunRuntimePolicy | null
): RunResult {
    if (error instanceof RunCollectionError) {
        return createCollectionErrorRunResult(error, runtimePolicy?.takeRunErrors() ?? []);
    }

    throw error;
}

async function reportCollectionResultWithDelivery(
    reporterDelivery: ReporterDelivery,
    result: RunResult
): Promise<RunResult> {
    try {
        const runnerErrorEventErrors = await reportRunnerErrorEvents(reporterDelivery, result.runnerErrors);
        const resultWithRunnerErrorDeliveryErrors = appendRunnerErrors(result, runnerErrorEventErrors);
        const runEndErrors = await reporterDelivery.reportEvent({
            kind: 'run-end',
            result: resultWithRunnerErrorDeliveryErrors
        });
        const resultForFinalReporting = appendRunnerErrors(resultWithRunnerErrorDeliveryErrors, runEndErrors);
        const finalReporterErrors = await reporterDelivery.reportResult(resultForFinalReporting);
        const disposeErrors = await reporterDelivery.disposeReporters();

        return appendRunnerErrors(resultForFinalReporting, [ ...finalReporterErrors, ...disposeErrors ]);
    } catch (error: unknown) {
        return await throwWithReporterCleanupErrors(error, reporterDelivery);
    }
}

type RunCollectionErrorContext = {
    readonly timing: RunTimingMeasurement | null;
    readonly benchmarkHost: RunFacts['benchmarkHost'];
};

export async function reportCollectionErrorResult(
    command: RunCommand,
    dependencies: RunOrchestratorDependencies,
    result: RunResult,
    context: RunCollectionErrorContext
): Promise<RunResult> {
    const profile = selectProfile(command.request.profile, command.config);
    const reporters = resolveRunReporters(profile, command.config.reporters);
    const reporterDelivery = await dependencies.reporterDispatcher.createDelivery(
        reporters,
        command.config.outputRenderer
    );
    const timedResult = resultWithTimingCollection(
        resolveTimingCollection(command.request, profile),
        result,
        context.timing
    );

    return await reportCollectionResultWithDelivery(
        reporterDelivery,
        await withRunErrorMetadata(timedResult, command, context.benchmarkHost)
    );
}
