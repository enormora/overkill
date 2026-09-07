import { AsyncLocalStorage } from 'node:async_hooks';
import type { RunnerError } from './run-result.ts';

type RunnerErrorDeliveryStore = {
    readonly deliveredRunnerErrors: () => readonly RunnerError[];
    readonly recordDeliveredRunnerError: (error: RunnerError) => void;
};

const runnerErrorDeliveryStorage = new AsyncLocalStorage<RunnerErrorDeliveryStore>();

export function recordRunnerErrorDelivery(error: RunnerError): void {
    runnerErrorDeliveryStorage.getStore()?.recordDeliveredRunnerError(error);
}

export async function trackRunnerErrorDelivery<Result>(
    work: () => Promise<Result>
): Promise<{
    readonly deliveredRunnerErrors: readonly RunnerError[];
    readonly result: Result;
}> {
    const deliveredRunnerErrors = new Set<RunnerError>();
    const deliveryStore: RunnerErrorDeliveryStore = {
        deliveredRunnerErrors() {
            return Array.from(deliveredRunnerErrors);
        },
        recordDeliveredRunnerError(error) {
            deliveredRunnerErrors.add(error);
        }
    };
    const result = await runnerErrorDeliveryStorage.run(deliveryStore, work);

    return {
        deliveredRunnerErrors: deliveryStore.deliveredRunnerErrors(),
        result
    };
}
