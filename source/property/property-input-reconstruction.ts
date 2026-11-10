import { inconclusivePropertyTrial } from '../packages/engine/engine.entry-point.ts';

export type TrialInputReconstruction<Value> = {
    readonly input: () => Value;
    readonly inconclusive: (reason: string) => never;
    readonly finish: () => void;
};

export function trialInputReconstruction<Value>(
    reconstruct: () => Value,
    consumeWork: () => void,
    signal: AbortSignal
): TrialInputReconstruction<Value> {
    let active = true;
    return {
        input() {
            if (!active) {
                throw new TypeError('Property input reconstruction requires an active trial.');
            }
            signal.throwIfAborted();
            consumeWork();
            return reconstruct();
        },
        inconclusive(reason) {
            if (!active) {
                throw new TypeError('Property inconclusive control requires an active trial.');
            }
            signal.throwIfAborted();
            return inconclusivePropertyTrial(reason);
        },
        finish() {
            active = false;
        }
    };
}
