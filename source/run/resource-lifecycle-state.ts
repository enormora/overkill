import { AsyncLocalStorage } from 'node:async_hooks';
import type { RunnerError } from '../engine/run-result.ts';
import type { AttemptId } from '../engine/identity.ts';
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
    readonly completeCase: (testCase: TestPlanCase, attempt: AttemptId) => Promise<void>;
    readonly acquireComposedResources: (
        steps: readonly ResourceWrapperStep[],
        signal: AbortSignal,
        messages: LifecycleMessages
    ) => Promise<ComposedResourceSession>;
    readonly acquireResourceScopes: (request: ManagedResourceScopeAcquisition) => Promise<void>;
    readonly disposeAll: (signal: AbortSignal) => Promise<readonly ManagedRunnerError[]>;
    readonly runAttempt: <Value>(
        testCase: TestPlanCase,
        attempt: AttemptId,
        run: () => Promise<Value>
    ) => Promise<Value>;
    readonly takeAttemptErrors: (testCase: TestPlanCase, attempt: AttemptId) => readonly ManagedRunnerError[];
    readonly takePendingRunErrors: () => readonly ManagedRunnerError[];
    readonly takeRunErrors: () => readonly ManagedRunnerError[];
};

const activeLifecycle = new AsyncLocalStorage<ManagedLifecycleState>();
const runningCase = new AsyncLocalStorage<{ readonly testCase: TestPlanCase; readonly attempt: AttemptId; }>();

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
    return runningCase.getStore()?.testCase ?? null;
}

export function currentLifecycleAttempt(): AttemptId | null {
    return runningCase.getStore()?.attempt ?? null;
}

export async function runWithLifecycleCase<Value>(
    testCase: TestPlanCase,
    attempt: AttemptId,
    run: () => Promise<Value>
): Promise<Value> {
    return await runningCase.run({ testCase, attempt }, async function runScopedCase() {
        return await runWithTranscriptScope(testCase, run);
    });
}
