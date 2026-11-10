import { setImmediate as yieldToEventLoop } from 'node:timers/promises';

const yieldInterval = 256;
export type SearchBudget = {
    readonly charge: () => Promise<void>;
    readonly work: () => number;
    readonly exhausted: (error: unknown) => boolean;
};
export function linearizabilityBudget(maxWork: number, signal: AbortSignal): SearchBudget {
    let work = 0;
    const exhaustion = new Error('Linearizability work budget exhausted.');
    return {
        async charge() {
            signal.throwIfAborted();
            if (work === maxWork) {
                throw exhaustion;
            }
            work += 1;
            if (work % yieldInterval === 0) {
                await yieldToEventLoop();
            }
            signal.throwIfAborted();
        },
        work() {
            return work;
        },
        exhausted(error) {
            return error === exhaustion;
        }
    };
}
