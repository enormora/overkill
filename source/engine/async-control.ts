import { setImmediate as waitForImmediate } from 'node:timers/promises';
import type { ThrownMatcher } from '../assertion-protocol/thrown-matcher.ts';
import type { AssertAssertionFacade } from './assertion-facade.ts';
import type { TestContractFailure } from './run-result.ts';

type CleanupCallback = () => Promise<void> | void;

type InFlightRecord<Value> = {
    readonly markObserved: () => void;
    readonly markSettled: () => void;
    readonly observed: () => boolean;
    readonly promise: Promise<Value>;
    readonly settlement: Promise<void>;
    readonly settled: () => boolean;
};

export type InFlightTask<Value> = {
    readonly rejects: (matcher: ThrownMatcher) => Promise<void>;
    readonly wait: () => Promise<Value>;
};

export type AsyncControlState = {
    readonly cleanupStarted: () => boolean;
    readonly inFlightRecords: () => readonly InFlightRecord<unknown>[];
    readonly registerCleanup: (callback: CleanupCallback) => void;
    readonly registerInFlight: (record: InFlightRecord<unknown>) => void;
    readonly startCleanup: () => readonly CleanupCallback[];
};

const settleCheckpointCount = 5;

export async function drainMicrotasks(): Promise<void> {
    await Promise.resolve();
}

export async function yieldToNextTurn(): Promise<void> {
    await waitForImmediate();
}

export async function settleAsyncWork(): Promise<void> {
    for (let checkpoint = 0; checkpoint < settleCheckpointCount; checkpoint += 1) {
        await drainMicrotasks();
        await yieldToNextTurn();
    }

    await drainMicrotasks();
}

export function createAsyncControlState(): AsyncControlState {
    let cleanupStarted = false;
    const cleanupCallbacks: CleanupCallback[] = [];
    const inFlightRecords: InFlightRecord<unknown>[] = [];

    return {
        cleanupStarted() {
            return cleanupStarted;
        },
        inFlightRecords() {
            return inFlightRecords;
        },
        registerCleanup(callback) {
            cleanupCallbacks.push(callback);
        },
        registerInFlight(record) {
            inFlightRecords.push(record);
        },
        startCleanup() {
            cleanupStarted = true;
            return cleanupCallbacks;
        }
    };
}

function callbackRegisteredAfterCleanupFailure(): TypeError {
    return new TypeError('scope.cleanup() cannot be called after test cleanup has started.');
}

export function registerCleanup(state: AsyncControlState, callback: CleanupCallback): void {
    if (state.cleanupStarted()) {
        throw callbackRegisteredAfterCleanupFailure();
    }

    state.registerCleanup(callback);
}

async function operationPromise<Value>(operation: () => PromiseLike<Value>): Promise<Value> {
    return await operation();
}

async function recordSettlement(record: Pick<InFlightRecord<unknown>, 'markSettled' | 'promise'>): Promise<void> {
    try {
        await record.promise;
    } catch {
    } finally {
        record.markSettled();
    }
}

export function startInFlight<Value>(
    state: AsyncControlState,
    assertContext: Pick<AssertAssertionFacade, 'rejects'>,
    operation: () => PromiseLike<Value>
): InFlightTask<Value> {
    let observed = false;
    let settled = false;
    const promise = operationPromise(operation);
    const record: InFlightRecord<Value> = {
        markObserved() {
            observed = true;
        },
        markSettled() {
            settled = true;
        },
        observed() {
            return observed;
        },
        promise,
        settlement: recordSettlement({
            markSettled() {
                settled = true;
            },
            promise
        }),
        settled() {
            return settled;
        }
    };

    state.registerInFlight(record);

    return {
        async rejects(matcher) {
            record.markObserved();
            await assertContext.rejects(async function waitForTrackedRejection() {
                return record.promise;
            }, matcher);
        },
        async wait() {
            record.markObserved();
            return await record.promise;
        }
    };
}

export async function runCleanups(state: AsyncControlState): Promise<readonly unknown[]> {
    const cleanupCallbacks = state.startCleanup();
    const errors: unknown[] = [];

    for (const cleanupCallback of cleanupCallbacks.toReversed()) {
        try {
            await cleanupCallback();
        } catch (error: unknown) {
            errors.push(error);
        }
    }

    return errors;
}

function pendingInFlightTaskFailure(count: number): TestContractFailure {
    return {
        actual: count,
        code: 'pending-in-flight-task',
        expected: 'all in-flight tasks to settle before the test ends',
        kind: 'test-contract',
        summary: 'In-flight tasks must settle before the test ends.'
    };
}

function unobservedInFlightTaskFailure(count: number): TestContractFailure {
    return {
        actual: count,
        code: 'unobserved-in-flight-task',
        expected: 'all in-flight tasks to be awaited or asserted before the test ends',
        kind: 'test-contract',
        summary: 'In-flight tasks must be observed before the test ends.'
    };
}

export function validateInFlightTasks(state: AsyncControlState): readonly TestContractFailure[] {
    const pendingCount = state
        .inFlightRecords()
        .filter(function pendingTask(record) {
            return !record.settled();
        })
        .length;
    const unobservedCount = state
        .inFlightRecords()
        .filter(function unobservedTask(record) {
            return record.settled() && !record.observed();
        })
        .length;
    const failures: TestContractFailure[] = [];

    if (pendingCount > 0) {
        failures.push(pendingInFlightTaskFailure(pendingCount));
    }

    if (unobservedCount > 0) {
        failures.push(unobservedInFlightTaskFailure(unobservedCount));
    }

    return failures;
}
