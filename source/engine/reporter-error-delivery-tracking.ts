import { AsyncLocalStorage } from 'node:async_hooks';
import type { RunnerError } from './run-result.ts';

type RunnerErrorDeliveryStore = {
    readonly deliveredRunnerErrors: () => readonly RunnerError[];
    readonly recordUndeliveredRunnerError: (error: RunnerError) => void;
    readonly recordDeliveredRunnerError: (error: RunnerError) => void;
    readonly undeliveredRunnerErrors: () => readonly RunnerError[];
};

const runnerErrorDeliveryStorage = new AsyncLocalStorage<RunnerErrorDeliveryStore>();

export function recordRunnerErrorDelivery(error: RunnerError): void {
    runnerErrorDeliveryStorage.getStore()?.recordDeliveredRunnerError(error);
}

export function recordUndeliveredRunnerError(error: RunnerError): void {
    runnerErrorDeliveryStorage.getStore()?.recordUndeliveredRunnerError(error);
}

export async function trackRunnerErrorDelivery<Result>(
    work: () => Promise<Result>
): Promise<{
    readonly deliveredRunnerErrors: readonly RunnerError[];
    readonly result: Result;
    readonly undeliveredRunnerErrors: readonly RunnerError[];
}> {
    const deliveredRunnerErrors = new Set<RunnerError>();
    const undeliveredRunnerErrors = new Set<RunnerError>();
    const deliveryStore: RunnerErrorDeliveryStore = {
        deliveredRunnerErrors() {
            return Array.from(deliveredRunnerErrors);
        },
        recordUndeliveredRunnerError(error) {
            undeliveredRunnerErrors.add(error);
        },
        recordDeliveredRunnerError(error) {
            deliveredRunnerErrors.add(error);
        },
        undeliveredRunnerErrors() {
            return Array.from(undeliveredRunnerErrors);
        }
    };
    const result = await runnerErrorDeliveryStorage.run(deliveryStore, work);

    return {
        deliveredRunnerErrors: deliveryStore.deliveredRunnerErrors(),
        result,
        undeliveredRunnerErrors: deliveryStore.undeliveredRunnerErrors()
    };
}
