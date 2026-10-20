import { z } from 'zod/v4';
import type {
    SamplingPolicy,
    BenchmarkNormalizationEvidence,
    CalibrationSnapshot
} from '../engine/benchmark-result.ts';
import { canonicalIdentityJson } from '../canonical-identity.ts';
import type { BenchmarkScope } from '../engine/test-node.ts';
import { CaseRunnerError, isCaseRunnerError } from '../engine/run-result.ts';
import { retainCalibrationFailure } from './calibration-failure.ts';
import type { CalibrationSession } from './calibration-definition.ts';
import type { MetricNormalization } from './calibrated-measurement.ts';
import { selectCalibrationReference } from './calibration-references.ts';

const sessionSchema = z.strictObject({
    collect: z.custom<CalibrationSession['collect']>(function callable(value) {
        return typeof value === 'function';
    })
});
export function calibrationResourceKey(rule: MetricNormalization): string {
    return `calibration:${canonicalIdentityJson(rule.calibration.calibration)}`;
}
async function metricCalibration(
    scope: BenchmarkScope,
    handles: Readonly<Record<string, unknown>>,
    rule: MetricNormalization
): Promise<CalibrationSnapshot> {
    const session = sessionSchema.parse(handles[calibrationResourceKey(rule)]);
    const result = await session.collect(scope);
    if (result.kind === 'non-comparable') {
        throw new CaseRunnerError(result.reason, { subtype: 'measurement', cause: result });
    }
    return result.snapshot;
}
function referenceEvidence(
    scope: BenchmarkScope,
    metric: string,
    actual: CalibrationSnapshot,
    rule: MetricNormalization
): BenchmarkNormalizationEvidence['metrics'][string] | null {
    const context = scope.benchmarkEnvironment?.normalization;
    if (context === undefined || context === null) {
        throw new TypeError('Normalization requires a benchmark runner reference context.');
    }
    return context.mode === 'capture'
        ? null
        : selectCalibrationReference({ context, work: scope.workId, metric, actual }, rule);
}
async function collectNormalization(
    scope: BenchmarkScope,
    resources: unknown,
    rules: Readonly<Record<string, MetricNormalization>>,
    record: (snapshot: CalibrationSnapshot) => void
): Promise<BenchmarkNormalizationEvidence['metrics']> {
    const handles = z.record(z.string(), z.unknown()).parse(resources);
    const metrics = new Map<string, BenchmarkNormalizationEvidence['metrics'][string]>();
    for (const [ metric, rule ] of Object.entries(rules)) {
        const actual = await metricCalibration(scope, handles, rule);
        record(actual);
        const evidence = referenceEvidence(scope, metric, actual, rule);
        if (evidence !== null) {
            metrics.set(metric, evidence);
        }
    }
    return Object.fromEntries(metrics);
}
export async function collectBenchmarkNormalization(
    scope: BenchmarkScope,
    resources: unknown,
    rules: Readonly<Record<string, MetricNormalization>>,
    policy: SamplingPolicy
): Promise<BenchmarkNormalizationEvidence | null> {
    if (Object.keys(rules).length === 0) {
        return null;
    }
    const calibrations = new Map<string, CalibrationSnapshot>();
    try {
        const metrics = await collectNormalization(scope, resources, rules, function retainSnapshot(snapshot) {
            calibrations.set(canonicalIdentityJson(snapshot.identity), snapshot);
        });
        return {
            version: 1,
            comparability: { kind: 'comparable' },
            calibrations: Array.from(calibrations.values()),
            metrics
        };
    } catch (error: unknown) {
        await retainCalibrationFailure(scope, policy, { error, calibrations: Array.from(calibrations.values()) });
        if (isCaseRunnerError(error)) {
            throw error;
        }
        throw new CaseRunnerError(error instanceof Error ? error.message : String(error), {
            subtype: 'measurement',
            cause: error
        });
    }
}
