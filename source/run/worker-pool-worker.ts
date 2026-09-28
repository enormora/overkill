import { createOverkillClock, type OverkillClock } from '../clock/overkill-clock.ts';
import { createExecute } from '../engine/execution.ts';
import { createReporterDispatcher } from '../engine/reporter-dispatcher.ts';
import {
    createPlainOutputRenderer,
    type RunResourceUsageTracker
} from '../packages/engine/engine.entry-point.ts';
import type {
    RunTimingSpan,
    RunTimingSpanKind,
    TimingSpanStatus
} from '../engine/run-timings.ts';
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

type WorkerExecutionMode = 'concurrent-in-process' | 'serial-in-process';

function workerProcessId(): string {
    return String(process.pid);
}

function postTimingSpan(
    task: WorkerPoolTask,
    kind: RunTimingSpanKind,
    status: TimingSpanStatus,
    startedAtMicroseconds: number,
    completedAtMicroseconds: number
): void {
    const span: RunTimingSpan = {
        durationMicroseconds: Math.max(0, Math.trunc(completedAtMicroseconds - startedAtMicroseconds)),
        kind,
        label: null,
        processId: workerProcessId(),
        resource: null,
        startOffsetMicroseconds: null,
        status,
        workerId: task.kind === 'run' ? task.lane : null
    };

    task.port.postMessage({ kind: 'timing', span }, []);
}

async function measureWorkerSpan<Value>(
    task: WorkerPoolTask,
    wallClock: OverkillClock,
    kind: RunTimingSpanKind,
    work: () => Promise<Value>
): Promise<Value> {
    const startedAtMicroseconds = wallClock.currentMonotonicMicroseconds;

    try {
        const value = await work();
        postTimingSpan(task, kind, 'success', startedAtMicroseconds, wallClock.currentMonotonicMicroseconds);

        return value;
    } catch (error: unknown) {
        postTimingSpan(task, kind, 'failure', startedAtMicroseconds, wallClock.currentMonotonicMicroseconds);
        throw error;
    }
}

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
    return createNodeResourceUsageTracker(createOverkillClock(), {
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
    wallClock: OverkillClock
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
    wallClock: OverkillClock,
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
    wallClock: OverkillClock,
    collectedPlan: CollectedWorkerPoolTestPlan
): Promise<WorkerPoolRunOutput['results']> {
    const results: WorkerPoolRunOutput['results'][number][] = [];

    for (const assignedUnit of task.assignedUnits) {
        results.push(await runAssignment(task, wallClock, collectedPlan, assignedUnit));
    }

    return results;
}

async function runAssignments(task: WorkerPoolRunTask, wallClock: OverkillClock): Promise<WorkerPoolRunOutput> {
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
    wallClock: OverkillClock
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
        postTimingSpan(
            task,
            'worker.teardown',
            'success',
            teardownStartedAtMicroseconds,
            wallClock.currentMonotonicMicroseconds
        );
        task.port.close();
    }
}

export async function runTask(task: WorkerPoolTask): Promise<WorkerPoolCollection | WorkerPoolRunOutput> {
    const wallClock = createOverkillClock();
    const createdAtMicroseconds = wallClock.currentMonotonicMicroseconds;

    postTimingSpan(task, 'worker.create', 'success', createdAtMicroseconds, createdAtMicroseconds);
    postTimingSpan(
        task,
        'worker.ready',
        'success',
        wallClock.currentMonotonicMicroseconds,
        wallClock.currentMonotonicMicroseconds
    );

    if (task.kind === 'collect') {
        return await runCollectionTask(task, wallClock);
    }

    try {
        return await runAssignments(task, wallClock);
    } finally {
        const teardownStartedAtMicroseconds = wallClock.currentMonotonicMicroseconds;
        postTimingSpan(
            task,
            'worker.teardown',
            'success',
            teardownStartedAtMicroseconds,
            wallClock.currentMonotonicMicroseconds
        );
        task.port.close();
    }
}
