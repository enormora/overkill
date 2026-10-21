import type { BenchmarkScope } from '../engine/test-node.ts';
import type { SamplingPolicy, CalibrationSnapshot } from '../engine/benchmark-result.ts';

type CalibrationFailure = { readonly error: unknown; readonly calibrations: readonly CalibrationSnapshot[]; };
export async function retainCalibrationFailure(
    scope: BenchmarkScope,
    policy: SamplingPolicy,
    failure: CalibrationFailure
): Promise<void> {
    const { error, calibrations } = failure;
    const reason = error instanceof Error ? error.message : String(error);
    await scope.updateResult({
        timeline: null,
        workload: scope.workload,
        policy,
        samples: 0,
        status: 'incomplete',
        assumption: 'independent-stationary-observations',
        lifecycle: null,
        metrics: {},
        budgets: [],
        normalization: { version: 1, comparability: { kind: 'non-comparable', reason }, calibrations, metrics: {} },
        rawSamples: { status: 'omitted', reference: null, reason: 'Calibration failed before benchmark sampling.' }
    });
}
