import { propertyObservationContractFailure } from '../packages/engine/engine.entry-point.ts';

type TrialTargets = {
    readonly target: (label: string, score: number) => void;
    readonly finish: () => ReadonlyMap<string, number>;
};

export function trialTargets(observeLabel: (label: string) => void): TrialTargets {
    let active = true;
    const scores = new Map<string, number>();
    return {
        target(label, score) {
            if (!active) {
                propertyObservationContractFailure('Property targeting observation outlived its trial.');
            }
            observeLabel(label);
            if (typeof score !== 'number' || !Number.isFinite(score)) {
                propertyObservationContractFailure('Property target scores must be finite numbers.');
            }
            const previous = scores.get(label);
            scores.set(label, previous === undefined ? score : Math.max(previous, score));
        },
        finish() {
            active = false;
            return new Map(scores);
        }
    };
}

export function propertyLabels(maximum: number): (label: string) => void {
    const labels = new Set<string>();
    return function observe(label) {
        if (typeof label !== 'string' || label.trim().length === 0) {
            propertyObservationContractFailure('Property observation labels must be nonblank strings.');
        }
        if (!labels.has(label) && labels.size === maximum) {
            propertyObservationContractFailure('Property observation label limit exceeded.');
        }
        labels.add(label);
    };
}
