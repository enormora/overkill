export type TrialInputReconstruction<Value> = {
    readonly input: () => Value;
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
        finish() {
            active = false;
        }
    };
}
