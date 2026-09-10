import asyncHooks, { AsyncLocalStorage } from 'node:async_hooks';
import { caseIdentityKey, type CaseId } from './identity.ts';
import type { RunnerError } from './run-result.ts';
import type { TestPlanCase } from './test-plan.ts';

type ActiveCase = {
    readonly id: CaseId;
    readonly key: string;
};

type TrackedPromise = {
    readonly caseId: CaseId;
    readonly caseKey: string;
    readonly consume: () => void;
    readonly consumed: () => boolean;
    readonly settle: () => void;
    readonly settled: () => boolean;
};

export type AsyncLeakMonitor = {
    readonly casePromiseLeakError: (testCase: TestPlanCase) => RunnerError | null;
    readonly runCase: <Value>(testCase: TestPlanCase, run: () => Promise<Value>) => Promise<Value>;
    readonly stop: () => void;
};

export function createDisabledAsyncLeakMonitor(): AsyncLeakMonitor {
    return {
        casePromiseLeakError() {
            return null;
        },
        async runCase(_testCase, run) {
            return await run();
        },
        stop() {
            return undefined;
        }
    };
}

type ActiveResourceLeakCause = {
    readonly capability: 'async-leak';
    readonly leak: 'active-resource';
    readonly phase: 'body' | 'run';
    readonly resourceTypes: readonly string[];
    readonly strictness: 'observed';
};

type PromiseLeakCause = {
    readonly capability: 'async-leak';
    readonly leak: 'promise';
    readonly pendingPromiseCount: number;
    readonly phase: 'body';
    readonly strictness: 'observed';
};

type ResourceCounts = ReadonlyMap<string, number>;

const activeCaseStorage = new AsyncLocalStorage<ActiveCase>();
const ignoredActiveResourceTypes = new Set([ 'PipeWrap' ]);

function sortedResourceTypes(types: readonly string[]): readonly string[] {
    return Array
        .from(types)
        .filter(function reportableResourceType(type) {
            return !ignoredActiveResourceTypes.has(type);
        })
        .toSorted(function compareType(first, second) {
            return first.localeCompare(second);
        });
}

function resourceCounts(types: readonly string[]): ResourceCounts {
    const counts = new Map<string, number>();

    for (const type of types) {
        counts.set(type, (counts.get(type) ?? 0) + 1);
    }

    return counts;
}

function increasedResourceTypes(before: readonly string[], after: readonly string[]): readonly string[] {
    const beforeCounts = resourceCounts(before);
    const afterCounts = resourceCounts(after);
    const increasedTypes: string[] = [];

    for (const [ type, afterCount ] of afterCounts) {
        const beforeCount = beforeCounts.get(type) ?? 0;

        if (afterCount > beforeCount) {
            increasedTypes.push(...Array.from({ length: afterCount - beforeCount }, function repeatType() {
                return type;
            }));
        }
    }

    return sortedResourceTypes(increasedTypes);
}

export function activeResourceLeakError(
    attributedTo: CaseId | null,
    before: readonly string[],
    after: readonly string[],
    phase: ActiveResourceLeakCause['phase']
): RunnerError | null {
    const resourceTypes = increasedResourceTypes(before, after);

    if (resourceTypes.length === 0) {
        return null;
    }

    const cause: ActiveResourceLeakCause = {
        capability: 'async-leak',
        leak: 'active-resource',
        phase,
        resourceTypes,
        strictness: 'observed'
    };

    return {
        attributedTo,
        cause,
        message: `Runtime policy violation: active resources leaked: ${resourceTypes.join(', ')}.`,
        subtype: 'runtime-policy'
    };
}

function promiseLeakError(testCase: TestPlanCase, pendingPromiseCount: number): RunnerError {
    const cause: PromiseLeakCause = {
        capability: 'async-leak',
        leak: 'promise',
        pendingPromiseCount,
        phase: 'body',
        strictness: 'observed'
    };

    return {
        attributedTo: testCase.id,
        cause,
        message: `Runtime policy violation: ${pendingPromiseCount} promise(s) still pending after test cleanup.`,
        subtype: 'runtime-policy'
    };
}

function createTrackedPromise(activeCase: ActiveCase): TrackedPromise {
    let consumed = false;
    let settled = false;

    return {
        caseId: activeCase.id,
        caseKey: activeCase.key,
        consume() {
            consumed = true;
        },
        consumed() {
            return consumed;
        },
        settle() {
            settled = true;
        },
        settled() {
            return settled;
        }
    };
}

export function createAsyncLeakMonitor(): AsyncLeakMonitor {
    const promises = new Map<number, TrackedPromise>();
    const createHookKey = 'createHook';
    const hook = asyncHooks[createHookKey]({
        destroy(asyncId) {
            promises.delete(asyncId);
        },
        init(asyncId, type, triggerAsyncId) {
            if (type !== 'PROMISE') {
                return;
            }

            const parentPromise = promises.get(triggerAsyncId);

            if (parentPromise !== undefined) {
                parentPromise.consume();
            }

            const activeCase = activeCaseStorage.getStore();

            if (activeCase !== undefined) {
                promises.set(asyncId, createTrackedPromise(activeCase));
            }
        },
        promiseResolve(asyncId) {
            const promise = promises.get(asyncId);

            if (promise !== undefined) {
                promise.settle();
            }
        }
    });

    hook.enable();

    return {
        casePromiseLeakError(testCase) {
            const key = caseIdentityKey(testCase.id);
            const pendingPromiseCount = Array
                .from(promises.values())
                .filter(function pendingCasePromise(promise) {
                    return promise.caseKey === key && !promise.settled() && !promise.consumed();
                })
                .length;

            if (pendingPromiseCount === 0) {
                return null;
            }

            return promiseLeakError(testCase, pendingPromiseCount);
        },
        async runCase(testCase, run) {
            return await activeCaseStorage.run({
                id: testCase.id,
                key: caseIdentityKey(testCase.id)
            }, run);
        },
        stop() {
            hook.disable();
            promises.clear();
        }
    };
}
