import { createClock } from '@enormora/clock';
import {
    acquireResourceLifecycleScopes,
    createResourceLifecycleSession,
    type ManagedResourceLifecycleTiming,
    type ResourceLifecycleSession
} from './resource-lifecycle.ts';
import { resourceLifecycleBoundaryUseCounts } from './resource-lifecycle-boundaries.ts';
import type { ResourceWrapperStep } from './resource-lifecycle-composition.ts';
import { createNodeResourceUsageTracker } from './resource-usage.ts';
import type { RunnerError, RunResourceUsageTracker, TestPlanCase } from './run-engine-primitives.ts';
import type {
    WorkerPoolAcquireRunResourcesTask,
    WorkerPoolCommand,
    WorkerPoolCompleteResourceOwnerWorkTask,
    WorkerPoolDisposeLaneLifecycleTask,
    WorkerPoolDisposeResourceOutput,
    WorkerPoolDisposeRunResourcesTask,
    WorkerPoolRunResourceOutput,
    WorkerPoolRunTask
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
