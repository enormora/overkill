import { createExecute } from '../engine/execution.ts';
import { createReporterDispatcher } from '../engine/reporter-dispatcher.ts';
import {
    createPlainOutputRenderer,
    type RunResourceUsageTracker
} from '../packages/engine/engine.entry-point.ts';
import {
    createRunPermissionRuntimePolicy,
    createRunResourceRuntimePolicy
} from './run-support.ts';
import { resolvedTestPlanDefinitionLocations } from './collected-run-plan.ts';
import { createNodeResourceUsageTracker } from './resource-usage.ts';
import {
    captureOutput,
    createWorkerPoolReporter,
    silentOutputSinks,
    suppressOutput
} from './worker-pool-output.ts';
import type {
    WorkerPoolCollection,
    WorkerPoolCommand,
    WorkerPoolAssignedUnit,
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

async function collectAssignmentTestPlan(
    task: WorkerPoolRunTask,
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
                runtimePolicy: createRunResourceRuntimePolicy(testPlan.cases, createRunPermissionRuntimePolicy()),
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
): Promise<WorkerPoolCollection | WorkerPoolRunOutput> {
    if (task.kind === 'collect') {
        return await runCollectionTask(task, wallClock);
    }

    try {
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

export async function runTask(task: WorkerPoolTask): Promise<WorkerPoolCollection | WorkerPoolRunOutput> {
    const wallClock = createWorkerTimingClock();

    recordWorkerStartup(task, wallClock);

    return await runTimedTask(task, wallClock);
}
