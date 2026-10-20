import { canonicalIdentityJson } from '../canonical-identity.ts';
import { workIdentityKey, type WorkId } from '../engine/identity.ts';
import type {
    BenchmarkNormalizationContext,
    BenchmarkNormalizationEvidence,
    CalibrationSnapshot,
    SavedCalibration
} from '../engine/benchmark-result.ts';
import { calibrationFactor } from './normalization-interval.ts';
import type { MetricNormalization } from './calibrated-measurement.ts';

type MetricEvidence = BenchmarkNormalizationEvidence['metrics'][string];
type ReferenceChoice = Pick<MetricEvidence, 'budgetReference' | 'reference' | 'source'>;
type ReferenceSelection = {
    readonly context: BenchmarkNormalizationContext;
    readonly work: WorkId;
    readonly metric: string;
    readonly actual: CalibrationSnapshot;
};
function matchingSaved(input: ReferenceSelection): readonly SavedCalibration[] {
    const identity = canonicalIdentityJson(input.actual.identity);
    return input.context.saved.filter(function matchingReference(entry) {
        return entry.metric === input.metric && workIdentityKey(entry.work) === workIdentityKey(input.work) &&
            canonicalIdentityJson(entry.actual.identity) === identity;
    });
}
function fixedReference(input: ReferenceSelection): ReferenceChoice {
    const identity = canonicalIdentityJson(input.actual.identity);
    const reference = input.context.references.find(function matchingReference(candidate) {
        return canonicalIdentityJson(candidate.identity) === identity &&
            candidate.machineClass === input.actual.machineClass;
    });
    if (reference === undefined) {
        throw new TypeError('Missing calibration reference. Run overkill bench calibrate for this machine class.');
    }
    return { reference, budgetReference: reference, source: 'fixed' };
}
function selectedReference(input: ReferenceSelection): ReferenceChoice {
    const saved = matchingSaved(input);
    const first = saved[0];
    if (first === undefined) {
        return fixedReference(input);
    }
    const key = canonicalIdentityJson([ first.actual, first.budgetReference ]);
    if (
        saved.some(function conflictingReference(entry) {
            return canonicalIdentityJson([ entry.actual, entry.budgetReference ]) !== key;
        })
    ) {
        throw new TypeError('Saved expectations disagree about the calibration reference.');
    }
    return { reference: first.actual, budgetReference: first.budgetReference, source: 'baseline' };
}
export function selectCalibrationReference(input: ReferenceSelection, rule: MetricNormalization): MetricEvidence {
    const selected = selectedReference(input);
    calibrationFactor(input.actual, selected.reference, rule.scaling);
    calibrationFactor(input.actual, selected.budgetReference, rule.scaling);
    return { ...selected, scaling: rule.scaling, actual: input.actual, factor: null, summary: null, budgets: [] };
}
