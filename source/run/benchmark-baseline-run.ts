import { evaluateBenchmarkHost } from '../bench/benchmark-host-assessment.ts';
import { prepareBenchmarkBaselineRun, type PreparedBenchmarkRun } from './benchmark-baseline-preparation.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import type { ResolvedRunInput } from './run-input-resolution.ts';
import { createResultFromResolutionError, reportCollectionErrorResult } from './run-collection-error-result.ts';
import type { RunCommand, RunInvocationOptions } from './run-types.ts';
import { RunCollectionError } from './run-errors.ts';

type RunTimingMeasurement = NonNullable<RunInvocationOptions['timing']>;
type BenchmarkHostAssessment = NonNullable<ResolvedRunInput['benchmarkHost']>;

type BenchmarkPreparationInput = {
    readonly command: RunCommand;
    readonly dependencies: RunOrchestratorDependencies;
    readonly input: ResolvedRunInput;
    readonly timing: RunTimingMeasurement;
};
type RunResult = Awaited<ReturnType<RunOrchestratorDependencies['execute']>>;

function benchmarkPreparationError(error: unknown, host: BenchmarkHostAssessment | null): RunCollectionError {
    return error instanceof RunCollectionError ? error : new RunCollectionError(
        error instanceof Error ? error.message : String(error),
        { cause: error },
        host === null ? 'measurement' : 'artifact'
    );
}

async function assessBenchmarkExecutionHost(
    input: ResolvedRunInput,
    dependencies: RunOrchestratorDependencies
): Promise<BenchmarkHostAssessment> {
    const { profile } = input;
    if (profile.testFamily !== 'benchmark') {
        throw new Error('Host calibration requires a benchmark profile.');
    }
    const snapshot = await dependencies.collectBenchmarkHost({
        timeoutMilliseconds: profile.timeouts.collectionMilliseconds
    });
    return evaluateBenchmarkHost(snapshot, profile.host.limits);
}

function assertBenchmarkHostAccepted(assessment: BenchmarkHostAssessment): void {
    const rejected = assessment.checks.filter(function rejectedCheck(check) {
        return check.status !== 'passed';
    });
    if (rejected.length > 0) {
        const messages = rejected.map(function rejection(check) {
            return check.status === 'unavailable'
                ? `${check.limit}: unavailable (${check.reason})`
                : `${check.limit}: observed ${check.observedPercent}%, configured ${check.configuredPercent}%`;
        });
        throw new RunCollectionError(`Benchmark host rejected: ${messages.join('; ')}.`, {
            cause: { kind: 'benchmark-host-rejected', assessment }
        }, 'measurement');
    }
}

export async function prepareBenchmarkExecution(
    options: BenchmarkPreparationInput
): Promise<PreparedBenchmarkRun | RunResult> {
    let assessment: BenchmarkHostAssessment | null = null;
    try {
        assessment = await assessBenchmarkExecutionHost(options.input, options.dependencies);
        assertBenchmarkHostAccepted(assessment);
        return await prepareBenchmarkBaselineRun({ ...options.input, benchmarkHost: assessment }, options.dependencies);
    } catch (error: unknown) {
        return await reportCollectionErrorResult(
            options.command,
            options.dependencies,
            createResultFromResolutionError(benchmarkPreparationError(error, assessment), null),
            { timing: options.timing, benchmarkHost: assessment }
        );
    }
}
