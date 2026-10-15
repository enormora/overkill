import { AsyncLocalStorage } from 'node:async_hooks';
import type { PerTestResult, RunnerError } from './run-result.ts';
import type { TestPlanCase } from './test-plan.ts';

export type CaseExecutionLifecycle = {
    readonly enter: (testCase: TestPlanCase) => Promise<void>;
    readonly complete: (result: PerTestResult, errors: readonly RunnerError[]) => Promise<'continue' | 'stop'>;
};

const lifecycleKey = Symbol.for('@overkill-dev/engine/caseExecutionLifecycle');

function isLifecycleStorage(value: unknown): value is AsyncLocalStorage<CaseExecutionLifecycle> {
    return value instanceof AsyncLocalStorage;
}

function sharedLifecycleStorage(): AsyncLocalStorage<CaseExecutionLifecycle> {
    const existing: unknown = Reflect.get(globalThis, lifecycleKey);
    if (isLifecycleStorage(existing)) {
        return existing;
    }
    const created = new AsyncLocalStorage<CaseExecutionLifecycle>();
    Reflect.set(globalThis, lifecycleKey, created);
    return created;
}

const lifecycle = sharedLifecycleStorage();

export const currentCaseExecutionLifecycle = function (): CaseExecutionLifecycle | null {
    return lifecycle.getStore() ?? null;
};

export async function withCaseExecutionLifecycle<Value>(
    observer: CaseExecutionLifecycle,
    run: () => Promise<Value>
): Promise<Value> {
    return await lifecycle.run(observer, run);
}
