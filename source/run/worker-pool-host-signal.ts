export type CompletionSignal = {
    readonly promise: Promise<void>;
    readonly reject: (error: Error) => void;
    readonly resolve: () => void;
};

function signalNotReady(): never {
    throw new Error('Hosted worker-pool signal was used before initialization.');
}

export function createCompletionSignal(): CompletionSignal {
    let resolveSignal: () => void = signalNotReady;
    let rejectSignal: (error: Error) => void = signalNotReady;
    const promise = new Promise<void>(function createSignal(resolve, reject) {
        resolveSignal = resolve;
        rejectSignal = reject;
    });

    return {
        promise,
        reject(error) {
            rejectSignal(error);
        },
        resolve() {
            resolveSignal();
        }
    };
}
