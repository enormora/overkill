import { AsyncLocalStorage } from 'node:async_hooks';
import { runWithAttachmentContext } from '../packages/resources/attachment-context.entry-point.ts';
import { createTranscriptAttemptScope } from '../attachments/resource-failure-context.ts';
import { runWithTranscriptScope } from '../transcript/transcript-store.ts';
import type { RunnerError } from '../engine/run-result.ts';
import { workIdentityKey, type WorkId, type AttemptId } from '../engine/identity.ts';
import type { TestPlanCase } from '../engine/test-plan.ts';
import type { AttachmentExecution } from './attachment-execution.ts';
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
    readonly prepareAttempt: (testCase: TestPlanCase, attempt: AttemptId) => Promise<void>;
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

const transcriptAttempts = new WeakMap<TestPlanCase, Map<number, Readonly<Record<string, unknown>>>>();
function transcriptAttemptScope(testCase: TestPlanCase, attempt: AttemptId): Readonly<Record<string, unknown>> {
    const attempts = transcriptAttempts.get(testCase) ?? new Map<number, Readonly<Record<string, unknown>>>();
    const scope = attempts.get(attempt.index) ?? createTranscriptAttemptScope(testCase.workId, attempt);
    attempts.set(attempt.index, scope);
    transcriptAttempts.set(testCase, attempts);
    return scope;
}

export async function runWithLifecycleCase<Value>(
    testCase: TestPlanCase,
    attempt: AttemptId,
    run: () => Promise<Value>
): Promise<Value> {
    return await runningCase.run({ testCase, attempt }, async function runScopedCase() {
        return await runWithTranscriptScope(transcriptAttemptScope(testCase, attempt), run);
    });
}

const executionContext = new AsyncLocalStorage<AttachmentExecution>();

export function currentAttachmentExecution(): AttachmentExecution | null {
    return executionContext.getStore() ?? null;
}

export async function runWithAttachmentExecution<Value>(
    execution: AttachmentExecution,
    run: () => Promise<Value>
): Promise<Value> {
    return await executionContext.run(execution, async function runAttachmentBoundary() {
        return await runWithAttachmentContext(execution.context, run);
    });
}

export async function prepareOwnedAttempt(
    lifecycle: ManagedLifecycleState,
    testCases: readonly TestPlanCase[],
    work: WorkId,
    attempt: AttemptId
): Promise<readonly ManagedRunnerError[]> {
    const testCase = testCases.find(function ownsWork(candidate) {
        return workIdentityKey(candidate.workId) === workIdentityKey(work);
    });
    if (testCase === undefined) {
        throw new TypeError('Resource preparation is outside the owner session.');
    }
    const prepare = async function prepareOwnedResources(): Promise<void> {
        await runWithLifecycleCase(testCase, attempt, async function prepareScopedResources() {
            await lifecycle.prepareAttempt(testCase, attempt);
        });
    };
    const attachments = currentAttachmentExecution();
    await (attachments === null ? prepare() : attachments.runAttempt(work, attempt, prepare));
    return [
        ...lifecycle.takeAttemptErrors(testCase, attempt),
        ...attachments?.takeErrors({ kind: 'case', work, attempt }) ?? []
    ];
}
