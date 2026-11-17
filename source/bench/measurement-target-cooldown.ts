import { createClock } from '@enormora/clock';
import type { BenchmarkCooldownPolicy, BenchmarkCooldownResult } from '../engine/benchmark-result.ts';
import { CaseRunnerError } from '../engine/run-result.ts';
import type { MeasurementTarget } from './measurement-target.ts';
import { awaitMeasurement, createMeasurementDeadline } from './measurement-shutdown.ts';

type TargetSettlingResult = { readonly evidence: BenchmarkCooldownResult; readonly error: Error | null; };
type RuntimePolicy = Extract<BenchmarkCooldownPolicy, { readonly mode: 'runtime'; }>;
type RuntimeResult = Extract<BenchmarkCooldownResult, { readonly mode: 'runtime'; }>;
export async function settleMeasurementTarget(
    target: MeasurementTarget,
    policy: RuntimePolicy,
    signal: AbortSignal,
    previous: RuntimeResult
): Promise<{ readonly evidence: BenchmarkCooldownResult; readonly error: Error | null; }> {
    const capability = target.cooldown;
    if (capability.kind === 'unavailable') {
        throw new CaseRunnerError(capability.reason, { subtype: 'measurement', cause: null });
    }
    const deadline = createMeasurementDeadline(createClock(), policy.timeoutMilliseconds);
    const combined = AbortSignal.any([ signal, deadline.signal ]);
    const settle = async function settleTarget(): Promise<TargetSettlingResult> {
        return await awaitMeasurement(capability.run(policy, combined, previous), combined);
    };
    try {
        return await deadline.run(settle);
    } finally {
        deadline.close();
    }
}
