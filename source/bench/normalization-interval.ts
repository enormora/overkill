import { canonicalIdentityJson } from '../canonical-identity.ts';
import type { CalibrationSnapshot, NormalizationRuleSummary } from '../engine/benchmark-result.ts';
import { quantileInterval, type StatisticalInterval } from './benchmark-budget.ts';
import { observationMedian } from './statistical-primitives.ts';

const medianProbability = 0.5;
const confidenceComponents = 2;
export type NormalizationScale = {
    readonly actual: CalibrationSnapshot;
    readonly reference: CalibrationSnapshot;
    readonly scaling: NormalizationRuleSummary['scaling'];
};
type PositiveRatio = { readonly lower: number; readonly upper: number | null; };
export function calibrationInterval(snapshot: CalibrationSnapshot, delta: number): StatisticalInterval {
    return quantileInterval(
        snapshot.samples,
        medianProbability,
        delta / (snapshot.checkpoint * (snapshot.checkpoint + 1))
    );
}
function assertComparableCalibrations(actual: CalibrationSnapshot, reference: CalibrationSnapshot): void {
    const identityMatches = canonicalIdentityJson(actual.identity) === canonicalIdentityJson(reference.identity);
    const executionMatches = canonicalIdentityJson(actual.execution.nodeArguments) ===
        canonicalIdentityJson(reference.execution.nodeArguments);
    if (actual.machineClass !== reference.machineClass || !identityMatches || !executionMatches) {
        throw new TypeError('Calibration references are not comparable.');
    }
}
export function calibrationFactor(
    actual: CalibrationSnapshot,
    reference: CalibrationSnapshot,
    scaling: NormalizationRuleSummary['scaling']
): number {
    assertComparableCalibrations(actual, reference);
    const actualMedian = observationMedian(actual.samples);
    const referenceMedian = observationMedian(reference.samples);
    const factor = scaling === 'proportional' ? referenceMedian / actualMedian : actualMedian / referenceMedian;
    if (!Number.isFinite(factor) || factor <= 0) {
        throw new TypeError('Normalization factor must be finite and positive.');
    }
    return factor;
}
function ratioEndpoint(numerator: number | null, denominator: number | null, absent: number | null): number | null {
    return numerator === null || denominator === null ? absent : numerator / denominator;
}
function calibrationRatio(scale: NormalizationScale, delta: number): PositiveRatio {
    const numerator = scale.scaling === 'proportional' ? scale.reference : scale.actual;
    const denominator = scale.scaling === 'proportional' ? scale.actual : scale.reference;
    const numeratorInterval = calibrationInterval(numerator, delta / confidenceComponents);
    const denominatorInterval = calibrationInterval(denominator, delta / confidenceComponents);
    return {
        lower: ratioEndpoint(numeratorInterval.lower, denominatorInterval.upper, 0) ?? 0,
        upper: ratioEndpoint(numeratorInterval.upper, denominatorInterval.lower, null)
    };
}
function scaledBound(value: number | null, ratio: PositiveRatio, side: 'lower' | 'upper'): number | null {
    if (value === null || value === 0) {
        return value;
    }
    const useUpper = value < 0 === (side === 'lower');
    const factor = useUpper ? ratio.upper : ratio.lower;
    if (factor === null) {
        return null;
    }
    const scaled = value * factor;
    return Number.isFinite(scaled) ? scaled : null;
}
export function normalizeStatisticalInterval(
    raw: StatisticalInterval,
    scale: NormalizationScale,
    delta: number
): StatisticalInterval {
    const estimate = raw.estimate * calibrationFactor(scale.actual, scale.reference, scale.scaling);
    if (!Number.isFinite(estimate)) {
        throw new TypeError('Normalized benchmark estimate is not finite.');
    }
    if (scale.actual === scale.reference) {
        return raw;
    }
    const ratio = calibrationRatio(scale, delta);
    return { estimate, lower: scaledBound(raw.lower, ratio, 'lower'), upper: scaledBound(raw.upper, ratio, 'upper') };
}
