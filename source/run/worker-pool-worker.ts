import { createExecute } from '../engine/execution.ts';
import { createReporterDispatcher } from '../engine/reporter-dispatcher.ts';
import {
    createPlainOutputRenderer,
    type RunResourceUsageTracker
} from '../packages/engine/engine.entry-point.ts';
import type { TestPlanCase } from '../engine/test-plan.ts';
import type { RunnerError } from '../engine/run-result.ts';
import {
    composeRunRuntimePolicies,
    createRunPermissionRuntimePolicy
} from './run-support.ts';
import { resolvedTestPlanDefinitionLocations } from './collected-run-plan.ts';
import { createNodeResourceUsageTracker } from './resource-usage.ts';
import {
    captureOutput,
    createWorkerPoolReporter,
    silentOutputSinks,
    suppressOutput
} from './worker-pool-output.ts';
import {
    acquireResourceLifecycleScopes,
    createResourceLifecycleSession,
    resourceLifecycleBoundaryUseCounts,
    type ResourceLifecycleSession
} from './resource-lifecycle.ts';
import type { ResourceWrapperStep } from './resource-lifecycle-composition.ts';
import type {
    WorkerPoolCollection,
    WorkerPoolCommand,
    WorkerPoolAssignedUnit,
    WorkerPoolDisposeResourceOutput,
    WorkerPoolDisposeLaneLifecycleTask,
    WorkerPoolDisposeRunResourcesTask,
    WorkerPoolAcquireRunResourcesTask,
    WorkerPoolRunResourceOutput,
    WorkerPoolRunOutput,
    WorkerPoolRunTask,
    WorkerPoolTask
} from './worker-pool-protocol.ts';
import {
    collectTestPlan,
    createEmptyAssignmentResult,
    runObservedWorkerCollection,
    selectedAssignedWork,
    sendCollectedPlan,
    type CollectedWorkerPoolTestPlan
} from './worker-pool-worker-plan.ts';
import {
    createWorkerTimingClock,
    measureWorkerSpan,
    postWorkerTimingSpan,
    type WorkerTimingClock
} from './worker-pool-worker-timing.ts';

type WorkerExecutionMode = 'concurrent-in-process' | 'serial-in-process';
type ResourceWrapperAction = ResourceWrapperStep | {
    readonly kind: 'scope';
};

const composedResourceBodyBrand = Symbol.for('@overkill-dev/test/ComposedResourceBody');
const runResourceScopes: ReadonlySet<string> = new Set([ 'per-run' ]);
const laneDisposalScopes = new Set([ 'per-case', 'per-file', 'per-suite' ] as const);
const runResourceOwners = new Map<string, ResourceLifecycleSession>();
const laneResourceSessions = new Map<string, ResourceLifecycleSession>();

function executionMode(command: WorkerPoolCommand): WorkerExecutionMode {
    return command.scheduling === 'concurrent' ? 'concurrent-in-process' : 'serial-in-process';
}

function workerResourceBudgets(command: WorkerPoolCommand): WorkerPoolCommand['resourceBudgets'] {
    return {
        activeResourceCount: command.resourceBudgets.activeResourceCount,
        javaScriptEngineHeapBytes: command.resourceBudgets.javaScriptEngineHeapBytes,
        residentSetBytes: null,
        residentSetGrowthBytesPerSecond: null
    };
}

function createResourceUsageTracker(command: WorkerPoolCommand): RunResourceUsageTracker {
    return createNodeResourceUsageTracker(createWorkerTimingClock(), {
        samplingIntervalMilliseconds: command.resourceUsageSamplingIntervalMilliseconds
    });
}

function startedAtIso(startedAtMilliseconds: number): string {
    const startedAt = new Date(startedAtMilliseconds);

    return startedAt.toISOString();
}

function readActiveResourceTypes(): readonly string[] {
    return process.getActiveResourcesInfo();
}

function lifecycleSessionKey(task: Pick<WorkerPoolRunTask, 'lane' | 'lifecycle'>): string {
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
    return new AbortController().signal;
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

async function collectAssignmentTestPlan(
    task: WorkerPoolAcquireRunResourcesTask | WorkerPoolRunTask,
    wallClock: WorkerTimingClock
): Promise<CollectedWorkerPoolTestPlan> {
    const bootstrapOutput = suppressOutput();

    try {
        return await measureWorkerSpan(
            task,
            wallClock,
            'worker.import-startup',
            async function collectTimedAssignmentTestPlan() {
                return await runObservedWorkerCollection(async function collectObservedAssignmentPlan() {
                    return await collectTestPlan(task.command);
                });
            }
        );
    } finally {
        bootstrapOutput.restore();
    }
}

async function runAssignment(
    task: WorkerPoolRunTask,
    wallClock: WorkerTimingClock,
    collectedPlan: CollectedWorkerPoolTestPlan,
    assignedUnit: WorkerPoolAssignedUnit
): Promise<WorkerPoolRunOutput['results'][number]> {
    const execute = createExecute({
        asyncLeakDiagnostics: 'enabled',
        readActiveResourceTypes,
        reporterDispatcher: createReporterDispatcher({
            ...silentOutputSinks,
            wallClock
        }),
        wallClock
    });

    task.port.postMessage({ kind: 'unit-started', traceUnit: assignedUnit.traceUnit }, []);
    const startedAtMicroseconds = wallClock.currentMonotonicMicroseconds;
    const testPlan = resolvedTestPlanDefinitionLocations(
        selectedAssignedWork(collectedPlan.testPlan, assignedUnit.work)
    );
    const resourceSession = laneResourceSession(task, collectedPlan);
    const result = await measureWorkerSpan(
        task,
        wallClock,
        'worker.assign-work',
        async function executeTimedWorkerAssignment() {
            return await execute(testPlan, {
                execution: { mode: executionMode(task.command) },
                outputRenderer: createPlainOutputRenderer(),
                reporters: [ createWorkerPoolReporter(task) ],
                resourceBudgets: workerResourceBudgets(task.command),
                resourceUsageTracker: createResourceUsageTracker(task.command),
                runtimePolicy: composeRunRuntimePolicies(
                    createRunPermissionRuntimePolicy(),
                    resourceSession.runtimePolicy
                ),
                runFacts: {},
                startedAt: startedAtIso(task.startedAtMilliseconds),
                timeoutPolicy: {
                    hardTimeoutMilliseconds: task.command.hardTimeoutMilliseconds,
                    timeoutMilliseconds: task.command.timeoutMilliseconds
                }
            });
        }
    );
    const completedAtMicroseconds = wallClock.currentMonotonicMicroseconds;

    task.port.postMessage(
        {
            durationMicroseconds: Math.max(0, completedAtMicroseconds - startedAtMicroseconds),
            kind: 'unit-completed',
            traceUnit: assignedUnit.traceUnit
        },
        []
    );

    return { result, traceUnit: assignedUnit.traceUnit };
}

function laneResourceSession(
    task: WorkerPoolRunTask,
    collectedPlan: CollectedWorkerPoolTestPlan
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
        projectedResources: task.projectedResources
    });

    laneResourceSessions.set(key, session);

    return session;
}

async function acquireRunResources(
    task: WorkerPoolAcquireRunResourcesTask,
    wallClock: WorkerTimingClock
): Promise<WorkerPoolRunResourceOutput> {
    const collectedPlan = await collectAssignmentTestPlan(task, wallClock);
    const testPlan = selectedAssignedWork(collectedPlan.testPlan, task.assignedWork);

    try {
        const session = await acquireResourceLifecycleScopes(
            {
                boundaryUseCounts: resourceLifecycleBoundaryUseCounts(testPlan.cases),
                caseDisposalScopes: new Set(),
                projectedResources: { resources: [] }
            },
            testPlan.cases,
            resourceWrapperSteps,
            freshSignal(),
            runResourceScopes
        );

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

async function disposeRunResources(
    task: WorkerPoolDisposeRunResourcesTask
): Promise<WorkerPoolDisposeResourceOutput> {
    const session = runResourceOwners.get(task.lifecycle.token);

    runResourceOwners.delete(task.lifecycle.token);

    return { runnerErrors: session === undefined ? [] : await session.disposeAll(freshSignal()) };
}

async function disposeLaneLifecycle(
    task: WorkerPoolDisposeLaneLifecycleTask
): Promise<WorkerPoolDisposeResourceOutput> {
    const key = lifecycleSessionKey(task);
    const session = laneResourceSessions.get(key);

    laneResourceSessions.delete(key);

    return { runnerErrors: session === undefined ? [] : await session.disposeAll(freshSignal()) };
}

async function runAssignedUnits(
    task: WorkerPoolRunTask,
    wallClock: WorkerTimingClock,
    collectedPlan: CollectedWorkerPoolTestPlan
): Promise<WorkerPoolRunOutput['results']> {
    const results: WorkerPoolRunOutput['results'][number][] = [];

    for (const assignedUnit of task.assignedUnits) {
        results.push(await runAssignment(task, wallClock, collectedPlan, assignedUnit));
    }

    return results;
}

async function runAssignments(task: WorkerPoolRunTask, wallClock: WorkerTimingClock): Promise<WorkerPoolRunOutput> {
    const collectedPlan = await collectAssignmentTestPlan(task, wallClock);

    if (task.assignedUnits.length === 0) {
        return createEmptyAssignmentResult();
    }

    const outputCapture = captureOutput(task, wallClock);

    try {
        return { results: await runAssignedUnits(task, wallClock, collectedPlan) };
    } finally {
        outputCapture.restore();
    }
}

async function runCollectionTask(
    task: Extract<WorkerPoolTask, { readonly kind: 'collect'; }>,
    wallClock: WorkerTimingClock
): Promise<WorkerPoolCollection> {
    const outputCapture = captureOutput(task, wallClock);

    try {
        return await measureWorkerSpan(
            task,
            wallClock,
            'worker.import-startup',
            async function collectTimedWorkerPlan() {
                return await runObservedWorkerCollection(async function collectObservedWorkerPlan() {
                    return sendCollectedPlan(await collectTestPlan(task.command));
                });
            }
        );
    } finally {
        outputCapture.restore();
        const teardownStartedAtMicroseconds = wallClock.currentMonotonicMicroseconds;
        postWorkerTimingSpan({
            completedAtMicroseconds: wallClock.currentMonotonicMicroseconds,
            kind: 'worker.teardown',
            startedAtMicroseconds: teardownStartedAtMicroseconds,
            status: 'success',
            task
        });
        task.port.close();
    }
}

function recordWorkerStartup(task: WorkerPoolTask, wallClock: WorkerTimingClock): void {
    const createdAtMicroseconds = wallClock.currentMonotonicMicroseconds;

    postWorkerTimingSpan({
        completedAtMicroseconds: createdAtMicroseconds,
        kind: 'worker.create',
        startedAtMicroseconds: createdAtMicroseconds,
        status: 'success',
        task
    });
    const readyAtMicroseconds = wallClock.currentMonotonicMicroseconds;
    postWorkerTimingSpan({
        completedAtMicroseconds: readyAtMicroseconds,
        kind: 'worker.ready',
        startedAtMicroseconds: readyAtMicroseconds,
        status: 'success',
        task
    });
}

async function runTimedTask(
    task: WorkerPoolTask,
    wallClock: WorkerTimingClock
): Promise<WorkerPoolCollection | WorkerPoolDisposeResourceOutput | WorkerPoolRunOutput | WorkerPoolRunResourceOutput> {
    if (task.kind === 'collect') {
        return await runCollectionTask(task, wallClock);
    }

    try {
        if (task.kind === 'acquire-run-resources') {
            return await acquireRunResources(task, wallClock);
        }

        if (task.kind === 'dispose-run-resources') {
            return await disposeRunResources(task);
        }

        if (task.kind === 'dispose-lane-lifecycle') {
            return await disposeLaneLifecycle(task);
        }

        return await runAssignments(task, wallClock);
    } finally {
        const teardownStartedAtMicroseconds = wallClock.currentMonotonicMicroseconds;
        postWorkerTimingSpan({
            completedAtMicroseconds: wallClock.currentMonotonicMicroseconds,
            kind: 'worker.teardown',
            startedAtMicroseconds: teardownStartedAtMicroseconds,
            status: 'success',
            task
        });
        task.port.close();
    }
}

export async function runTask(
    task: WorkerPoolTask
): Promise<WorkerPoolCollection | WorkerPoolDisposeResourceOutput | WorkerPoolRunOutput | WorkerPoolRunResourceOutput> {
    const wallClock = createWorkerTimingClock();

    recordWorkerStartup(task, wallClock);

    return await runTimedTask(task, wallClock);
}
