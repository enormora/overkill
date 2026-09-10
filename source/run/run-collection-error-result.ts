import type { ReporterDelivery } from '../engine/reporter-dispatcher.ts';
import type { RunResult } from '../engine/run-result.ts';
import { RunCollectionError } from './run-errors.ts';
import { selectedProfile } from './run-facts.ts';
import { resolveRunReporters, type RunRuntimePolicy } from './run-support.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import type { RunCommand } from './run-types.ts';

function createCollectionErrorRunResult(
    error: RunCollectionError,
    runtimePolicyErrors: readonly RunResult['runnerErrors'][number][]
): RunResult {
    return {
        artifacts: [],
        bySuite: {},
        orphans: [],
        perTest: [],
        resourceUsage: null,
        runnerErrors: [ ...runtimePolicyErrors, error.runnerError() ],
        summary: {
            crashed: 0,
            defined: 0,
            discovered: 0,
            failed: 0,
            inconclusive: 0,
            passed: 0,
            planned: 0,
            resourceExhausted: 0,
            runtimePolicy: 0,
            skipped: 0
        },
        wallTimeMs: 0
    };
}

function appendRunnerErrors(result: RunResult, runnerErrors: readonly RunResult['runnerErrors'][number][]): RunResult {
    if (runnerErrors.length === 0) {
        return result;
    }

    return {
        ...result,
        runnerErrors: [ ...result.runnerErrors, ...runnerErrors ]
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

export function createResultFromResolutionError(
    error: unknown,
    runtimePolicy: RunRuntimePolicy | null
): RunResult {
    if (error instanceof RunCollectionError) {
        return createCollectionErrorRunResult(error, runtimePolicy?.takeRunErrors() ?? []);
    }

    throw error;
}

export async function reportCollectionErrorResult(
    command: RunCommand,
    dependencies: RunOrchestratorDependencies,
    result: RunResult
): Promise<RunResult> {
    const profile = selectedProfile(command.request, command.config);
    const reporters = resolveRunReporters(profile, command.config.reporters);
    const reporterDelivery = await dependencies.reporterDispatcher.createDelivery(
        reporters,
        command.config.outputRenderer
    );

    try {
        const runEndErrors = await reporterDelivery.reportEvent({
            kind: 'run-end',
            result
        });
        const resultForFinalReporting = appendRunnerErrors(result, runEndErrors);
        const finalReporterErrors = await reporterDelivery.reportResult(resultForFinalReporting);
        const disposeErrors = await reporterDelivery.disposeReporters();

        return appendRunnerErrors(resultForFinalReporting, [ ...finalReporterErrors, ...disposeErrors ]);
    } catch (error: unknown) {
        return await throwWithReporterCleanupErrors(error, reporterDelivery);
    }
}
