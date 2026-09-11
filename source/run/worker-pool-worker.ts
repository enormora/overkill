import { createWallClock } from '@enormora/wall-clock';
import { createExecute } from '../engine/execution.ts';
import { createReporterDispatcher } from '../engine/reporter-dispatcher.ts';
import {
    createPlainOutputRenderer,
    type RunResourceUsageTracker
} from '../packages/engine/engine.entry-point.ts';
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
    WorkerPoolRunOutput,
    WorkerPoolRunTask,
    WorkerPoolTask
} from './worker-pool-protocol.ts';
import {
    collectTestPlan,
    createEmptyAssignmentResult,
    selectedAssignedCases,
    sendCollectedPlan,
    type CollectedWorkerPoolTestPlan
} from './worker-pool-worker-plan.ts';

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
    return createNodeResourceUsageTracker(createWallClock(), {
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

async function collectAssignmentTestPlan(task: WorkerPoolRunTask): Promise<CollectedWorkerPoolTestPlan> {
    const bootstrapOutput = suppressOutput();

    try {
        return await collectTestPlan(task.command);
    } finally {
        bootstrapOutput.restore();
    }
}

async function runAssignment(
    task: WorkerPoolRunTask,
    wallClock: ReturnType<typeof createWallClock>
): Promise<WorkerPoolRunOutput> {
    const collectedPlan = await collectAssignmentTestPlan(task);

    if (task.assignedCases.length === 0) {
        return createEmptyAssignmentResult(collectedPlan.testPlan, wallClock, task.startedAtMilliseconds);
    }

    const outputCapture = captureOutput(task, wallClock);
    const execute = createExecute({
        asyncLeakDiagnostics: 'enabled',
        readActiveResourceTypes,
        reporterDispatcher: createReporterDispatcher({
            ...silentOutputSinks,
            wallClock
        }),
        wallClock
    });

    try {
        const result = await execute(selectedAssignedCases(collectedPlan.testPlan, task.assignedCases), {
            execution: { mode: executionMode(task.command) },
            outputRenderer: createPlainOutputRenderer(),
            reporters: [ createWorkerPoolReporter(task) ],
            resourceBudgets: workerResourceBudgets(task.command),
            resourceUsageTracker: createResourceUsageTracker(task.command),
            runtimePolicy: null,
            runFacts: {},
            startedAt: startedAtIso(task.startedAtMilliseconds),
            timeoutPolicy: {
                hardTimeoutMilliseconds: task.command.hardTimeoutMilliseconds,
                timeoutMilliseconds: task.command.timeoutMilliseconds
            }
        });

        return { result };
    } finally {
        outputCapture.restore();
    }
}

export async function runTask(task: WorkerPoolTask): Promise<WorkerPoolCollection | WorkerPoolRunOutput> {
    const wallClock = createWallClock();

    if (task.kind === 'collect') {
        const outputCapture = captureOutput(task, wallClock);

        try {
            return sendCollectedPlan(await collectTestPlan(task.command));
        } finally {
            outputCapture.restore();
            task.port.close();
        }
    }

    try {
        return await runAssignment(task, wallClock);
    } finally {
        task.port.close();
    }
}
