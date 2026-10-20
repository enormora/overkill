import { canonicalIdentityJson } from '../canonical-identity.ts';
import { workIdentityKey, type WorkId } from '../engine/identity.ts';
import type {
    BenchmarkNormalizationContext,
    BenchmarkNormalizationEvidence,
    CalibrationSnapshot,
    NormalizationRuleSummary,
    SavedCalibration
} from '../engine/benchmark-result.ts';
import { canonicalCalibration } from './canonical-calibration.ts';
import { calibrationFactor } from './normalization-interval.ts';

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
    const execution = canonicalIdentityJson(input.actual.execution.nodeArguments);
    const references = input.context.references.filter(function matchingReference(candidate) {
        return canonicalIdentityJson(candidate.identity) === identity &&
            canonicalIdentityJson(candidate.execution.nodeArguments) === execution;
    });
    const reference = references.find(function localReference(candidate) {
        return candidate.machineClass === input.actual.machineClass;
    }) ?? references[0];
    const canonical = canonicalCalibration(input.actual);
    return reference === undefined
        ? { reference: canonical, budgetReference: canonical, source: 'canonical' }
        : { reference, budgetReference: canonical, source: 'fixed' };
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
export function selectCalibrationReference(
    input: ReferenceSelection,
    scaling: NormalizationRuleSummary['scaling']
): MetricEvidence {
    const selected = selectedReference(input);
    calibrationFactor(input.actual, selected.reference, scaling);
    const budgetFactor = calibrationFactor(input.actual, selected.budgetReference, scaling);
    return {
        ...selected,
        budgetFactor,
        scaling,
        actual: input.actual,
        factor: null,
        summary: null,
        budgets: []
    };
}
