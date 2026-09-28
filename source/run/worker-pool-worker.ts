import { createExecute } from '../engine/execution.ts';
import { createReporterDispatcher } from '../engine/reporter-dispatcher.ts';
import { createPlainOutputRenderer } from '../packages/engine/engine.entry-point.ts';
import {
    composeRunRuntimePolicies,
    createRunPermissionRuntimePolicy
} from './run-support.ts';
import { resolvedTestPlanDefinitionLocations } from './collected-run-plan.ts';
import {
    captureOutput,
    createWorkerPoolReporter,
    silentOutputSinks,
    suppressOutput
} from './worker-pool-output.ts';
import {
    acquireWorkerRunResources,
    createWorkerResourceUsageTracker,
    disposeWorkerLaneLifecycle,
    disposeWorkerRunResources,
    laneResourceSession
} from './worker-pool-worker-resources.ts';
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
    createWorkerResourceLifecycleTiming,
    measureWorkerSpan,
    postWorkerTimingSpan,
    type WorkerTimingClock
} from './worker-pool-worker-timing.ts';

type WorkerExecutionMode = 'concurrent-in-process' | 'serial-in-process';

type TimedAssignmentPlanTask = WorkerPoolAcquireRunResourcesTask | WorkerPoolRunTask;

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

function startedAtIso(startedAtMilliseconds: number): string {
    const startedAt = new Date(startedAtMilliseconds);

    return startedAt.toISOString();
}

function readActiveResourceTypes(): readonly string[] {
    return process.getActiveResourcesInfo();
}

async function collectAssignmentTestPlan(
    task: TimedAssignmentPlanTask,
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
    const resourceSession = laneResourceSession(
        task,
        collectedPlan,
        createWorkerResourceLifecycleTiming(task, wallClock)
    );
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
                resourceUsageTracker: createWorkerResourceUsageTracker(task.command),
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

async function acquireRunResources(
    task: WorkerPoolAcquireRunResourcesTask,
    wallClock: WorkerTimingClock
): Promise<WorkerPoolRunResourceOutput> {
    const collectedPlan = await collectAssignmentTestPlan(task, wallClock);

    return await acquireWorkerRunResources(
        task,
        collectedPlan,
        createWorkerResourceLifecycleTiming(task, wallClock)
    );
}

async function disposeRunResources(
    task: WorkerPoolDisposeRunResourcesTask
): Promise<WorkerPoolDisposeResourceOutput> {
    return await disposeWorkerRunResources(task);
}

async function disposeLaneLifecycle(
    task: WorkerPoolDisposeLaneLifecycleTask
): Promise<WorkerPoolDisposeResourceOutput> {
    return await disposeWorkerLaneLifecycle(task);
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

type WorkerPoolTaskOutputs = {
    readonly collect: WorkerPoolCollection;
    readonly disposeResource: WorkerPoolDisposeResourceOutput;
    readonly run: WorkerPoolRunOutput;
    readonly runResource: WorkerPoolRunResourceOutput;
};
type WorkerPoolTaskOutput = WorkerPoolTaskOutputs[keyof WorkerPoolTaskOutputs];

async function runWorkerTask(
    task: Exclude<WorkerPoolTask, { readonly kind: 'collect'; }>,
    wallClock: WorkerTimingClock
): Promise<WorkerPoolTaskOutput> {
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
}

async function runClosableTask(
    task: Exclude<WorkerPoolTask, { readonly kind: 'collect'; }>,
    wallClock: WorkerTimingClock
): Promise<WorkerPoolTaskOutput> {
    try {
        return await runWorkerTask(task, wallClock);
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

export async function runTask(task: WorkerPoolTask): Promise<WorkerPoolTaskOutput> {
    const wallClock = createWorkerTimingClock();

    recordWorkerStartup(task, wallClock);

    return task.kind === 'collect'
        ? await runCollectionTask(task, wallClock)
        : await runClosableTask(task, wallClock);
}
