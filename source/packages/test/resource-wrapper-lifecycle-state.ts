import { AsyncLocalStorage } from 'node:async_hooks';
import type { TestPlanCase } from '../../engine/test-plan.ts';
import type { ManagedLifecycleState } from './resource-wrapper-session-types.ts';

const activeLifecycle = new AsyncLocalStorage<ManagedLifecycleState>();
const runningCase = new AsyncLocalStorage<TestPlanCase>();

export function activeManagedLifecycle(): ManagedLifecycleState | null {
    return activeLifecycle.getStore() ?? null;
}

export async function runWithManagedLifecycle<Value>(
    lifecycle: ManagedLifecycleState,
    run: () => Promise<Value>
): Promise<Value> {
    return await activeLifecycle.run(lifecycle, run);
}

export function currentLifecycleCase(): TestPlanCase | null {
    return runningCase.getStore() ?? null;
}

export async function runWithLifecycleCase<Value>(
    testCase: TestPlanCase,
    run: () => Promise<Value>
): Promise<Value> {
    return await runningCase.run(testCase, run);
}
