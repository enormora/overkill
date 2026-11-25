import asyncHooks, { AsyncLocalStorage } from 'node:async_hooks';
import { observeResourceOwnerAllocations } from './resource-owner-observation.ts';
import { createExecutionObservation } from './execution-observation.ts';
import type { CaseId, WorkId } from './identity.ts';
import type { RunnerError } from './run-result.ts';
import type { TestPlanCase } from './test-plan.ts';

type ActiveCase = {
    readonly testCase: TestPlanCase;
};

export type AsyncLeakMonitor = {
    readonly runOutsideCase: <Value>(run: () => Promise<Value>) => Promise<Value>;
    readonly casePromiseLeakError: (testCase: TestPlanCase) => RunnerError | null;
    readonly runCase: <Value>(testCase: TestPlanCase, run: () => Promise<Value>) => Promise<Value>;
    readonly stop: () => void;
};

export function createDisabledAsyncLeakMonitor(): AsyncLeakMonitor {
    return {
        async runOutsideCase(run) {
            return await run();
        },
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
type ActiveResourceLeakInput = {
    readonly after: readonly string[];
    readonly attributedTo: CaseId | null;
    readonly attributedToWork: WorkId | null;
    readonly before: readonly string[];
    readonly phase: ActiveResourceLeakCause['phase'];
};

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

export function activeResourceLeakError(input: ActiveResourceLeakInput): RunnerError | null {
    const resourceTypes = increasedResourceTypes(input.before, input.after);

    if (resourceTypes.length === 0) {
        return null;
    }

    const cause: ActiveResourceLeakCause = {
        capability: 'async-leak',
        leak: 'active-resource',
        phase: input.phase,
        resourceTypes,
        strictness: 'observed'
    };

    return {
        attributedToAttempt: null,
        attributedTo: input.attributedTo,
        attributedToWork: input.attributedToWork,
        cause,
        diagnostics: [
            { label: 'capability', value: cause.capability },
            { label: 'phase', value: cause.phase },
            { label: 'resources', value: resourceTypes.join(', ') }
        ],
        message: `Runtime policy violation: active Node resources leaked: ${resourceTypes.join(', ')}.`,
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
        attributedToAttempt: null,
        attributedTo: testCase.id,
        attributedToWork: testCase.workId,
        cause,
        diagnostics: [
            { label: 'capability', value: cause.capability },
            { label: 'phase', value: cause.phase },
            { label: 'pending promises', value: String(pendingPromiseCount) }
        ],
        message: `Runtime policy violation: ${pendingPromiseCount} promise(s) still pending after test cleanup.`,
        subtype: 'runtime-policy'
    };
}

function countPendingPromises(
    promises: ReadonlyMap<number, ActiveCase>,
    activeCase: ActiveCase | undefined
): number {
    let count = 0;
    for (const owner of promises.values()) {
        if (owner === activeCase) {
            count += 1;
        }
    }
    return count;
}

export function createAsyncLeakMonitor(): AsyncLeakMonitor {
    const activeCaseStorage = new AsyncLocalStorage<ActiveCase>();
    const observation = createExecutionObservation();
    const stopResourceAllocations = observeResourceOwnerAllocations();
    const pendingPromises = new Map<number, ActiveCase>();
    const attempts = new WeakMap<TestPlanCase, ActiveCase>();
    function releasePromise(asyncId: number): void {
        pendingPromises.delete(asyncId);
    }
    const createHookKey = 'createHook';
    const hook = asyncHooks
        [createHookKey]({
            destroy: releasePromise,
            init(asyncId, type, triggerAsyncId) {
                if (type !== 'PROMISE' || !observation.accepts()) {
                    return;
                }

                releasePromise(triggerAsyncId);
                const activeCase = activeCaseStorage.getStore();

                if (activeCase !== undefined) {
                    pendingPromises.set(asyncId, activeCase);
                }
            },
            promiseResolve: releasePromise
        })
        .enable();
    observation.register(function stopPromiseObservation() {
        hook.disable();
        stopResourceAllocations();
        pendingPromises.clear();
    });

    return {
        async runOutsideCase(run) {
            return await activeCaseStorage.exit(run);
        },
        casePromiseLeakError(testCase) {
            const activeCase = attempts.get(testCase);
            const pendingPromiseCount = countPendingPromises(pendingPromises, activeCase);

            if (pendingPromiseCount === 0) {
                return null;
            }

            return promiseLeakError(testCase, pendingPromiseCount);
        },
        async runCase(testCase, run) {
            const activeCase = { testCase };
            attempts.set(testCase, activeCase);
            const operation = async function trackCasePromises(): Promise<Awaited<ReturnType<typeof run>>> {
                return await activeCaseStorage.run(activeCase, run);
            };
            return observation.hasActiveAttempt()
                ? await operation()
                : await observation.runAttempt(testCase, { index: 0 }, operation);
        },
        stop() {
            observation.stop();
        }
    };
}
