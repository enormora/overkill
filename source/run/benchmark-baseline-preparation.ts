import { readdir } from 'node:fs/promises';
import path from 'node:path';
import type { ComparableCalibration } from '../bench/host-calibration-result.ts';
import type { ResolvedRunInput } from './run-input-resolution.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import type { BenchmarkBaselineSession } from './benchmark-baseline-session.ts';
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

async function baselineCalibration(input: ResolvedRunInput, required: boolean): Promise<ComparableCalibration | null> {
    if (!required) {
        return null;
    }
    if (input.profile.testFamily !== 'benchmark') {
        throw new Error('Performance calibration requires a benchmark profile.');
    }
    const { collectBenchmarkCalibration } = await import('./benchmark-calibration.ts');
    const calibration = await collectBenchmarkCalibration({ cwd: input.projectRoot, profile: input.profile });
    if (calibration.kind === 'non-comparable') {
        throw new RunCollectionError(calibration.reason, { cause: calibration }, 'artifact');
    }
    return calibration;
}

export async function prepareBenchmarkBaselineRun(
    input: ResolvedRunInput,
    dependencies: RunOrchestratorDependencies
): Promise<PreparedBenchmarkRun> {
    if (input.profile.testFamily !== 'benchmark') {
        throw new Error('Performance baseline execution requires a benchmark profile.');
    }
    const calibration = await baselineCalibration(
        input,
        input.benchmarkPurpose !== 'capture' && await requiresBaselineSession({ ...input, profile: input.profile })
    );
    const { prepareBenchmarkNormalization } = await import('./benchmark-normalization-preparation.ts');
    const normalization = await prepareBenchmarkNormalization(input, calibration, dependencies);
    const preparedInput = {
        ...input,
        benchmarkCalibration: calibration,
        benchmarkNormalization: normalization.context
    };
    if (normalization.capture !== null || calibration === null) {
        return { input: preparedInput, session: normalization.capture ?? normalization.maintain(null) };
    }
    const baseline = await import('./benchmark-baseline-session.ts');
    return {
        input: preparedInput,
        session: normalization.maintain(
            await baseline.createBenchmarkBaselineSession({
                calibration,
                clock: dependencies.wallClock,
                profile: input.profile,
                projectRoot: input.projectRoot,
                reporterDispatcher: dependencies.reporterDispatcher,
                request: input.request
            })
        )
    };
}

export type PreparedBenchmarkRun = {
    readonly input: ResolvedRunInput;
    readonly session: BenchmarkBaselineSession | null;
};
