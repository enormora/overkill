import { randomUUID } from 'node:crypto';
import type { ResourceCheckSnapshot } from '../resource-check-protocol.ts';
import { resourceCheckSnapshotKey } from '../resource-check-snapshot.ts';
import { workIdentityKey, type AttemptId, type WorkId } from '../engine/identity.ts';
import { resourceCheckClient, finalizeRemoteResourceChecks } from './resource-check-client.ts';
import {
    workerImplementationPlan,
    withWorkerImplementations,
    runWithWorkerImplementations,
    closeWorkerImplementations
} from './worker-implementation-plan.ts';
import type {
    TestRuntimePolicy,
    RunnerError,
    TestPlanCase
} from './run-engine-primitives.ts';
import { resourcePreparationError } from './resource-failure-preparation.ts';
import {
    acquireResourceLifecycleScopes,
    createResourceLifecycleSession,
    type ManagedResourceLifecycleTiming,
    type ResourceLifecycleSession
} from './resource-lifecycle.ts';
import { resourceLifecycleBoundaryUseCounts } from './resource-lifecycle-boundaries.ts';
import type { ResourceWrapperStep } from './resource-lifecycle-composition.ts';
import type {
    WorkerResourceTask as WorkerPoolAcquireRunResourcesTask,
    WorkerCompleteResourcesTask as WorkerPoolCompleteResourceOwnerWorkTask,
    WorkerDisposeLaneTask as WorkerPoolDisposeLaneLifecycleTask,
    WorkerPoolDisposeResourceOutput,
    WorkerDisposeResourcesTask as WorkerPoolDisposeRunResourcesTask,
    WorkerPoolRunResourceOutput,
    WorkerRunTask as WorkerPoolRunTask,
    WorkerPoolPreparationReply
} from './worker-pool-protocol.ts';
import {
    selectedAssignedWork,
    type CollectedWorkerPoolTestPlan
    // eslint-disable-next-line import/max-dependencies -- This orchestration boundary consumes the resource-check protocol directly.
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

function lifecycleSessionKey(task: WorkerPoolLifecycleSessionKeyInput): string {
    return `${task.lifecycle.token}:${task.lane}`;
}

function isComposedResourceBody(value: unknown): value is {
    readonly [composedResourceBodyBrand]: {
        readonly actions: readonly ResourceWrapperAction[];
    };
} {
    return (typeof value === 'function' || typeof value === 'object' && value !== null) &&
        Object.hasOwn(value, composedResourceBodyBrand);
}

function resourceWrapperSteps(testCase: TestPlanCase): readonly ResourceWrapperStep[] {
    if (testCase.execution.kind !== 'body') {
        return [];
    }

    const body = testCase.execution.bodyMode === 'benchmark'
        ? testCase.execution.resourceBody
        : testCase.execution.body;
    if (!isComposedResourceBody(body)) {
        return [];
    }

    return body[composedResourceBodyBrand].actions.flatMap(function toStep(action) {
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
        existingSession.updateProjectedResources(task.projectedResources);
        return existingSession;
    }

    const runPlan = selectedAssignedWork(collectedPlan.testPlan, task.runWork, task.workloadInputs);
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
    const testPlan = workerImplementationPlan(
        selectedAssignedWork(collectedPlan.testPlan, task.assignedWork, task.workloadInputs),
        task
    );

    try {
        const session = await withWorkerImplementations(task.lifecycle.token, testPlan, async function acquire() {
            return await acquireResourceLifecycleScopes({
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
        });

        runResourceOwners.set(task.lifecycle.token, session);

        return {
            projectedResources: await runWithWorkerImplementations(task.lifecycle.token, async function project() {
                return session.projectionRecords();
            }),
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
        runnerErrors: session === undefined
            ? []
            : await runWithWorkerImplementations(task.lifecycle.token, async function complete() {
                return await session.completeBoundaries(task.boundaryKeys);
            })
    };
}

async function disposeImplementationSession(
    key: string,
    session: ResourceLifecycleSession | undefined
): Promise<readonly RunnerError[]> {
    if (session === undefined) {
        return [];
    }
    return await runWithWorkerImplementations(key, async function dispose() {
        return await session.disposeAll(freshSignal());
    });
}
export async function disposeWorkerRunResources(
    task: WorkerPoolDisposeRunResourcesTask
): Promise<WorkerPoolDisposeResourceOutput> {
    const session = runResourceOwners.get(task.lifecycle.token);

    runResourceOwners.delete(task.lifecycle.token);

    try {
        return {
            runnerErrors: await disposeImplementationSession(task.lifecycle.token, session)
        };
    } finally {
        await closeWorkerImplementations(task.lifecycle.token);
    }
}

export async function disposeWorkerLaneLifecycle(
    task: WorkerPoolDisposeLaneLifecycleTask
): Promise<WorkerPoolDisposeResourceOutput> {
    const key = lifecycleSessionKey(task);
    const session = laneResourceSessions.get(key);

    laneResourceSessions.delete(key);

    try {
        return {
            runnerErrors: await disposeImplementationSession(key, session)
        };
    } finally {
        await closeWorkerImplementations(key);
    }
}

export async function prepareLocalOwnerResources(
    lifecycle: WorkerPoolRunTask['lifecycle'],
    work: WorkId,
    attempt: AttemptId
): Promise<readonly RunnerError[] | null> {
    const session = runResourceOwners.get(lifecycle.token);
    return session === undefined ? null : await runWithWorkerImplementations(lifecycle.token, async function prepare() {
        return await session.prepareAttempt(work, attempt);
    });
}

function observePreparationReplies(
    task: WorkerPoolRunTask,
    request: string,
    completed: PromiseWithResolvers<readonly RunnerError[]>
): () => void {
    function receivePreparation(message: WorkerPoolPreparationReply): void {
        if (message.request === request) {
            completed.resolve(message.runnerErrors);
        }
    }
    function rejectClosedPreparation(): void {
        completed.reject(new Error('Resource owner preparation channel closed.'));
    }

    task.port.on('message', receivePreparation);
    task.port.once('close', rejectClosedPreparation);
    return function stopObservingPreparation() {
        task.port.off('message', receivePreparation);
        task.port.off('close', rejectClosedPreparation);
    };
}
async function remoteOwnerPreparation(
    task: WorkerPoolRunTask,
    work: Parameters<TestRuntimePolicy['prepareAttempt']>[0]['workId'],
    attempt: Parameters<TestRuntimePolicy['prepareAttempt']>[1]
): Promise<readonly RunnerError[]> {
    const request = `${workIdentityKey(work)}:${attempt.index}`;
    const completed = Promise.withResolvers<readonly RunnerError[]>();
    const stop = observePreparationReplies(task, request, completed);
    try {
        task.port.postMessage({ kind: 'prepare-resource-artifacts', request, work, attempt }, []);
    } catch (error: unknown) {
        completed.reject(error);
    }
    try {
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
async function admitResourceChecks(task: WorkerPoolRunTask, testCase: TestPlanCase, attempt: AttemptId): Promise<void> {
    if (task.lifecycle.endpoint === null) {
        return;
    }
    const admission = await resourceCheckClient(task.lifecycle.endpoint).exchange({
        kind: 'admit',
        request: randomUUID(),
        interval: { kind: 'attempt', work: testCase.workId, attempt }
    });
    if (admission.errors.length > 0) {
        throw new AggregateError(admission.errors, 'Resource admission failed.');
    }
}
type ProjectedCheckEvidence = {
    readonly failures: PreparationFailures;
    readonly snapshots: Checkpoints;
};
async function collectResourceChecks(
    task: WorkerPoolRunTask,
    testCase: TestPlanCase,
    attempt: AttemptId,
    evidence: ProjectedCheckEvidence
): Promise<void> {
    if (task.lifecycle.endpoint === null) {
        return;
    }
    const result = await finalizeRemoteResourceChecks(task.lifecycle.endpoint, {
        kind: 'attempt',
        work: testCase.workId,
        attempt
    });
    for (const snapshot of result.snapshots) {
        evidence.snapshots.set(resourceCheckSnapshotKey(snapshot), snapshot);
    }
    if (result.errors.length > 0) {
        throw new AggregateError(result.errors, 'Resource observation is incomplete.');
    }
}
async function finishResourceChecks(
    task: WorkerPoolRunTask,
    testCase: TestPlanCase,
    attempt: AttemptId,
    evidence: ProjectedCheckEvidence
): Promise<void> {
    try {
        await collectResourceChecks(task, testCase, attempt, evidence);
    } catch (error: unknown) {
        const key = `${workIdentityKey(testCase.workId)}:${attempt.index}`;
        evidence.failures.set(key, [ ...evidence.failures.get(key) ?? [], {
            attributedTo: testCase.id,
            attributedToWork: testCase.workId,
            attributedToAttempt: attempt,
            cause: error,
            diagnostics: [],
            message: 'Resource observation finalization failed.',
            subtype: 'fixture'
        } ]);
    }
}
export function withProjectedFailurePreparation(policy: TestRuntimePolicy, task: WorkerPoolRunTask): TestRuntimePolicy {
    const failures = new Map<string, readonly RunnerError[]>();
    const snapshots = new Map<string, ResourceCheckSnapshot>();
    return {
        ...policy,
        resourceChecks() {
            return [ ...policy.resourceChecks(), ...snapshots.values() ];
        },
        async runAttempt(testCase, attempt, run) {
            await admitResourceChecks(task, testCase, attempt);
            try {
                return await policy.runAttempt(testCase, attempt, run);
            } finally {
                await finishResourceChecks(task, testCase, attempt, { failures, snapshots });
            }
        },
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

type PreparationFailures = Map<string, readonly RunnerError[]>;

type Checkpoints = Map<string, ResourceCheckSnapshot>;
