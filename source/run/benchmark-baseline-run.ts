import { readdir } from 'node:fs/promises';
import path from 'node:path';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import type { ResolvedRunInput } from './run-input-resolution.ts';
import type { BenchmarkBaselineSession } from './benchmark-baseline-session.ts';
import { createResultFromResolutionError, reportCollectionErrorResult } from './run-collection-error-result.ts';
import type { RunCommand, RunOrchestrator } from './run-types.ts';
import type { RunTimingMeasurement } from './run-timing-collection.ts';
import { RunCollectionError } from './run-errors.ts';

type BenchmarkInput = ResolvedRunInput & {
    readonly profile: Extract<ResolvedRunInput['profile'], { readonly testFamily: 'benchmark'; }>;
};

async function requiresBaselineSession(input: BenchmarkInput): Promise<boolean> {
    if (input.profile.baselines.adapters.length > 0 || input.request.baselineUpdateMode !== 'none') {
        return true;
    }
    try {
        const names = await readdir(path.resolve(input.projectRoot, input.profile.baselines.directory, 'performance'));
        return names.some(function performanceFile(name) {
            return name.endsWith('.benchmark.json');
        });
    } catch (error: unknown) {
        if (error instanceof Error && Reflect.get(error, 'code') === 'ENOENT') {
            return false;
        }
        throw error;
    }
}

async function prepareBenchmarkBaselineRun(
    input: ResolvedRunInput,
    dependencies: RunOrchestratorDependencies
): Promise<PreparedBenchmarkRun> {
    if (input.profile.testFamily !== 'benchmark') {
        throw new Error('Performance baseline execution requires a benchmark profile.');
    }
    if (!await requiresBaselineSession({ ...input, profile: input.profile })) {
        return { input, session: null };
    }
    const { collectBenchmarkCalibration } = await import('./benchmark-calibration.ts');
    const calibration = await collectBenchmarkCalibration({ cwd: input.projectRoot, profile: input.profile });
    if (calibration.kind === 'non-comparable') {
        throw new RunCollectionError(calibration.reason, { cause: calibration }, 'artifact');
    }
    const baseline = await import('./benchmark-baseline-session.ts');
    return {
        input: { ...input, benchmarkCalibration: calibration },
        session: await baseline.createBenchmarkBaselineSession({
            calibration,
            clock: dependencies.wallClock,
            profile: input.profile,
            projectRoot: input.projectRoot,
            reporterDispatcher: dependencies.reporterDispatcher,
            request: input.request
        })
    };
}

export type PreparedBenchmarkRun = {
    readonly input: ResolvedRunInput;
    readonly session: BenchmarkBaselineSession | null;
};
type BenchmarkPreparationInput = {
    readonly command: RunCommand;
    readonly dependencies: RunOrchestratorDependencies;
    readonly input: ResolvedRunInput;
    readonly timing: RunTimingMeasurement;
};
type RunResult = Awaited<ReturnType<RunOrchestrator['run']>>;

function baselineResolutionError(error: unknown): RunCollectionError {
    return error instanceof RunCollectionError ? error : new RunCollectionError(
        error instanceof Error ? error.message : String(error),
        { cause: error },
        'artifact'
    );
}

export async function prepareBenchmarkExecution(
    options: BenchmarkPreparationInput
): Promise<PreparedBenchmarkRun | RunResult> {
    try {
        return await prepareBenchmarkBaselineRun(options.input, options.dependencies);
    } catch (error: unknown) {
        return await reportCollectionErrorResult(
            options.command,
            options.dependencies,
            createResultFromResolutionError(baselineResolutionError(error), null),
            options.timing
        );
    }
}
