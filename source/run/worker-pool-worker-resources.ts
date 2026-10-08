import { createClock } from '@enormora/clock';
import { workIdentityKey, type AttemptId, type WorkId } from '../engine/identity.ts';
import { resourcePreparationError } from './resource-failure-preparation.ts';
import type { TestRuntimePolicy, RunnerError, RunResourceUsageTracker, TestPlanCase } from './run-engine-primitives.ts';
import {
    acquireResourceLifecycleScopes,
    createResourceLifecycleSession,
    type ManagedResourceLifecycleTiming,
    type ResourceLifecycleSession
} from './resource-lifecycle.ts';
import { resourceLifecycleBoundaryUseCounts } from './resource-lifecycle-boundaries.ts';
import type { ResourceWrapperStep } from './resource-lifecycle-composition.ts';
import { createNodeResourceUsageTracker } from './resource-usage.ts';
import type {
    WorkerPoolAcquireRunResourcesTask,
    WorkerPoolCommand,
    WorkerPoolCompleteResourceOwnerWorkTask,
    WorkerPoolDisposeLaneLifecycleTask,
    WorkerPoolDisposeResourceOutput,
    WorkerPoolDisposeRunResourcesTask,
    WorkerPoolRunResourceOutput,
    WorkerPoolRunTask,
    WorkerPoolPreparationReply
} from './worker-pool-protocol.ts';
import {
    selectedAssignedWork,
    type CollectedWorkerPoolTestPlan
} from './worker-pool-worker-plan.ts';

type ResourceWrapperAction = ResourceWrapperStep | {
    readonly kind: 'scope';
};
type WorkerPoolLifecycleSessionKeyInput = Pick<WorkerPoolRunTask, 'lane' | 'lifecycle'>;

const composedResourceBodyBrand = Symbol.for('@overkill-dev/test/ComposedResourceBody');
const externallyOwnedResourceScopes: ReadonlySet<string> = new Set([ 'per-file', 'per-run', 'per-suite' ]);
const laneDisposalScopes = new Set([ 'per-case', 'per-file', 'per-suite' ] as const);
const runResourceOwners = new Map<string, ResourceLifecycleSession>();
const laneResourceSessions = new Map<string, ResourceLifecycleSession>();

export function createWorkerResourceUsageTracker(command: WorkerPoolCommand): RunResourceUsageTracker {
    return createNodeResourceUsageTracker(createClock(), {
        samplingIntervalMilliseconds: command.resourceUsageSamplingIntervalMilliseconds
    });
}

function lifecycleSessionKey(task: WorkerPoolLifecycleSessionKeyInput): string {
    return `${task.lifecycle.token}:${task.lane}`;
}

function isComposedResourceBody(value: unknown): value is {
    readonly [composedResourceBodyBrand]: {
        readonly actions: readonly ResourceWrapperAction[];
    };
} {
    return typeof value === 'function' && Object.hasOwn(value, composedResourceBodyBrand);
}

function resourceWrapperSteps(testCase: TestPlanCase): readonly ResourceWrapperStep[] {
    if (testCase.execution.kind !== 'body' || !isComposedResourceBody(testCase.execution.body)) {
        return [];
    }

    return testCase.execution.body[composedResourceBodyBrand].actions.flatMap(function toStep(action) {
        return action.kind === 'resources' || action.kind === 'runtime' ? [ action ] : [];
    });
}

function freshSignal(): AbortSignal {
    const controller = new AbortController();

    return controller.signal;
}

function runnerError(message: string, cause: unknown): RunnerError {
    return {
        attributedToAttempt: null,
        attributedTo: null,
        attributedToWork: null,
        cause,
        diagnostics: [],
        message,
        subtype: 'runtime-policy'
    };
}

export function laneResourceSession(
    task: WorkerPoolRunTask,
    collectedPlan: CollectedWorkerPoolTestPlan,
    timing: ManagedResourceLifecycleTiming
): ResourceLifecycleSession {
    const key = lifecycleSessionKey(task);
    const existingSession = laneResourceSessions.get(key);

    if (existingSession !== undefined) {
        return existingSession;
    }

    const runPlan = selectedAssignedWork(collectedPlan.testPlan, task.runWork);
    const session = createResourceLifecycleSession({
        testCases: runPlan.cases,
        boundaryUseCounts: resourceLifecycleBoundaryUseCounts(runPlan.cases),
        caseDisposalScopes: laneDisposalScopes,
        projectedResources: task.projectedResources,
        timing
    });

    laneResourceSessions.set(key, session);

    return session;
}

export async function acquireWorkerRunResources(
    task: WorkerPoolAcquireRunResourcesTask,
    collectedPlan: CollectedWorkerPoolTestPlan,
    timing: ManagedResourceLifecycleTiming
): Promise<WorkerPoolRunResourceOutput> {
    const testPlan = selectedAssignedWork(collectedPlan.testPlan, task.assignedWork);

    try {
        const session = await acquireResourceLifecycleScopes({
            boundaryKeys: new Set(task.boundaryKeys),
            options: {
                testCases: testPlan.cases,
                boundaryUseCounts: resourceLifecycleBoundaryUseCounts(testPlan.cases),
                caseDisposalScopes: new Set(),
                projectedResources: { resources: [] },
                timing
            },
            scopes: externallyOwnedResourceScopes,
            signal: freshSignal(),
            stepsForCase: resourceWrapperSteps,
            testCases: testPlan.cases
        });

        runResourceOwners.set(task.lifecycle.token, session);

        return {
            projectedResources: session.projectionRecords(),
            runnerErrors: []
        };
    } catch (error: unknown) {
        return {
            projectedResources: { resources: [] },
            runnerErrors: [ runnerError('Resource acquisition failed.', error) ]
        };
    }
}

export async function completeWorkerResourceOwnerWork(
    task: WorkerPoolCompleteResourceOwnerWorkTask
): Promise<WorkerPoolDisposeResourceOutput> {
    const session = runResourceOwners.get(task.lifecycle.token);

    return {
        runnerErrors: session === undefined ? [] : await session.completeBoundaries(task.boundaryKeys)
    };
}

export async function disposeWorkerRunResources(
    task: WorkerPoolDisposeRunResourcesTask
): Promise<WorkerPoolDisposeResourceOutput> {
    const session = runResourceOwners.get(task.lifecycle.token);

    runResourceOwners.delete(task.lifecycle.token);

    return { runnerErrors: session === undefined ? [] : await session.disposeAll(freshSignal()) };
}

export async function disposeWorkerLaneLifecycle(
    task: WorkerPoolDisposeLaneLifecycleTask
): Promise<WorkerPoolDisposeResourceOutput> {
    const key = lifecycleSessionKey(task);
    const session = laneResourceSessions.get(key);

    laneResourceSessions.delete(key);

    return { runnerErrors: session === undefined ? [] : await session.disposeAll(freshSignal()) };
}

export async function prepareLocalOwnerResources(
    lifecycle: WorkerPoolRunTask['lifecycle'],
    work: WorkId,
    attempt: AttemptId
): Promise<readonly RunnerError[] | null> {
    const session = runResourceOwners.get(lifecycle.token);
    return session === undefined ? null : await session.prepareAttempt(work, attempt);
}

function observePreparationReplies(
    task: WorkerPoolRunTask,
    receive: (reply: WorkerPoolPreparationReply) => void,
    closed: () => void
): () => void {
    task.port.on('message', receive);
    task.port.once('close', closed);
    return function stopObservingPreparation() {
        task.port.off('message', receive);
        task.port.off('close', closed);
    };
}
async function remoteOwnerPreparation(
    task: WorkerPoolRunTask,
    work: Parameters<TestRuntimePolicy['prepareAttempt']>[0]['workId'],
    attempt: Parameters<TestRuntimePolicy['prepareAttempt']>[1]
): Promise<readonly RunnerError[]> {
    const request = `${workIdentityKey(work)}:${attempt.index}`;
    const completed = Promise.withResolvers<readonly RunnerError[]>();
    function receivePreparation(message: WorkerPoolPreparationReply): void {
        if (message.request === request) {
            completed.resolve(message.runnerErrors);
        }
    }
    function rejectClosedPreparation(): void {
        completed.reject(new Error('Resource owner preparation channel closed.'));
    }
    const stop = observePreparationReplies(task, receivePreparation, rejectClosedPreparation);
    try {
        task.port.postMessage({ kind: 'prepare-resource-artifacts', request, work, attempt }, []);
        return await completed.promise;
    } finally {
        stop();
    }
}

async function requestOwnerPreparation(
    task: WorkerPoolRunTask,
    work: WorkId,
    attempt: AttemptId
): Promise<readonly RunnerError[]> {
    const local = await prepareLocalOwnerResources(task.lifecycle, work, attempt);
    return local ?? await remoteOwnerPreparation(task, work, attempt);
}
async function ownerPreparationErrors(
    task: WorkerPoolRunTask,
    testCase: Parameters<TestRuntimePolicy['prepareAttempt']>[0],
    attempt: Parameters<TestRuntimePolicy['prepareAttempt']>[1]
): Promise<readonly RunnerError[]> {
    try {
        return await requestOwnerPreparation(task, testCase.workId, attempt);
    } catch (error: unknown) {
        const failure = resourcePreparationError('projected resources', testCase, attempt, error).take();
        return failure === null ? [] : [ failure ];
    }
}
export function withProjectedFailurePreparation(policy: TestRuntimePolicy, task: WorkerPoolRunTask): TestRuntimePolicy {
    const failures = new Map<string, readonly RunnerError[]>();
    return {
        ...policy,
        async prepareAttempt(testCase, attempt) {
            await policy.prepareAttempt(testCase, attempt);
            if (task.projectedResources.resources.length > 0) {
                const errors = await ownerPreparationErrors(task, testCase, attempt);
                failures.set(`${workIdentityKey(testCase.workId)}:${attempt.index}`, errors);
            }
        },
        takeAttemptErrors(testCase, attempt) {
            const key = `${workIdentityKey(testCase.workId)}:${attempt.index}`;
            const errors = failures.get(key) ?? [];
            failures.delete(key);
            return [ ...policy.takeAttemptErrors(testCase, attempt), ...errors ];
        }
    };
}
