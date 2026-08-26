import { validateReporterSinks } from '../engine/reporter.ts';
import type { RunResult } from '../engine/run-result.ts';
import { RunCollectionError } from './run-errors.ts';
import { selectedProfile } from './run-facts.ts';
import { resolveRunReporters, type RunRuntimePolicy } from './run-support.ts';
import type { RunCommand, RunOrchestratorDependencies } from './run-types.ts';

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
    reporters: RunCommand['config']['reporters'],
    dependencies: RunOrchestratorDependencies
): Promise<never> {
    const disposeErrors = await dependencies.reporterDispatcher.disposeReporters(reporters);

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

    try {
        validateReporterSinks(reporters);
        const runEndErrors = await dependencies.reporterDispatcher.reportEvent(reporters, {
            kind: 'run-end',
            result
        }, command.config.outputRenderer);
        const resultForFinalReporting = appendRunnerErrors(result, runEndErrors);
        const finalReporterErrors = await dependencies.reporterDispatcher.reportResult(
            reporters,
            resultForFinalReporting,
            command.config.outputRenderer
        );
        const disposeErrors = await dependencies.reporterDispatcher.disposeReporters(reporters);

        return appendRunnerErrors(resultForFinalReporting, [ ...finalReporterErrors, ...disposeErrors ]);
    } catch (error: unknown) {
        return await throwWithReporterCleanupErrors(error, reporters, dependencies);
    }
}
