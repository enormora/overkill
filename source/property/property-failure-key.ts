import { propertyObservationContractFailure } from '../packages/engine/engine.entry-point.ts';

export type TrialFailureKey = {
    readonly set: (key: string) => void;
    readonly finish: () => string | null;
};

export function trialFailureKey(): TrialFailureKey {
    let active = true;
    let retained: string | null = null;
    return {
        set(key) {
            if (!active || typeof key !== 'string' || key.trim().length === 0) {
                propertyObservationContractFailure('Failure keys require a nonblank string within an active trial.');
            }
            if (retained !== null && retained !== key) {
                propertyObservationContractFailure('A trial cannot declare conflicting failure keys.');
            }
            retained = key;
        },
        finish() {
            active = false;
            return retained;
        }
    };
}
