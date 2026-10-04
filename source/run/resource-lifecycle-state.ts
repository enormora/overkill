import { AsyncLocalStorage } from 'node:async_hooks';
import type { RunnerError } from '../engine/run-result.ts';
import type { TestPlanCase } from '../engine/test-plan.ts';
import { runWithTranscriptScope } from '../transcript/transcript-store.ts';
import type {
    ComposedResourceSession,
    LifecycleMessages,
    ResourceWrapperStep
} from './resource-lifecycle-composition.ts';

export type ManagedRunnerError = RunnerError;

type ManagedResourceScopeAcquisition = {
    readonly boundaryKeys: ReadonlySet<string>;
    readonly scopes: ReadonlySet<string>;
    readonly signal: AbortSignal;
    readonly steps: readonly ResourceWrapperStep[];
    readonly testCase: TestPlanCase;
};

export type ManagedLifecycleState = {
    readonly acquireComposedResources: (
        steps: readonly ResourceWrapperStep[],
        signal: AbortSignal,
        messages: LifecycleMessages
    ) => Promise<ComposedResourceSession>;
    readonly acquireResourceScopes: (request: ManagedResourceScopeAcquisition) => Promise<void>;
    readonly disposeAll: (signal: AbortSignal) => Promise<readonly ManagedRunnerError[]>;
    readonly runCase: <Value>(testCase: TestPlanCase, run: () => Promise<Value>) => Promise<Value>;
    readonly takeCaseErrors: (testCase: TestPlanCase) => readonly ManagedRunnerError[];
    readonly takePendingRunErrors: () => readonly ManagedRunnerError[];
    readonly takeRunErrors: () => readonly ManagedRunnerError[];
};

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
    return await runningCase.run(testCase, async function runScopedCase() {
        return await runWithTranscriptScope(testCase, run);
    });
}
