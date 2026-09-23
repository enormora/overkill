import type { WorkerPoolCommand } from './worker-pool-protocol.ts';
import {
    runStartTimeFromMilliseconds,
    type WorkerPoolRunRuntime,
    type WorkerPoolTaskRun
} from './worker-pool-runtime.ts';
import {
    findResourceBudgetBreach,
    resourceExhaustionError
} from './supervised-run-resource-policy.ts';
import {
    createSupervisedRunState,
    type SupervisedRunState
} from './supervised-run-state.ts';

type RuntimeReporterEvent = Parameters<WorkerPoolRunRuntime['reporterDelivery']['reportEvent']>[0];
type PoolResourceUsageSample = NonNullable<ReturnType<WorkerPoolRunRuntime['previousPoolSample']['read']>>;

async function recordReporterEventErrors(
    event: RuntimeReporterEvent,
    runtime: WorkerPoolRunRuntime
): Promise<void> {
    const errors = await runtime.reporterDelivery.reportEvent(event);

    if (errors.length > 0) {
        runtime.runState.recordRunnerErrors(errors);
    }
}

function clearTaskTimeout(taskRun: WorkerPoolTaskRun, runtime: WorkerPoolRunRuntime): void {
    const timeout = taskRun.timeout.read();

    if (timeout !== null) {
        runtime.dependencies.wallClock.clearTimeout(timeout);
        taskRun.timeout.write(null);
    }
}

function poolResourceBudgets(runtime: WorkerPoolRunRuntime): WorkerPoolCommand['resourceBudgets'] {
    const { budgets } = runtime.resolvedRun.facts.execution.resourceUsagePolicy;

    return {
        activeResourceCount: null,
        javaScriptEngineHeapBytes: null,
        residentSetBytes: budgets.residentSetBytes,
        residentSetGrowthBytesPerSecond: budgets.residentSetGrowthBytesPerSecond
    };
}

function createActiveCaseState(runtime: WorkerPoolRunRuntime): SupervisedRunState {
    const activeState = createSupervisedRunState();

    for (const taskRun of runtime.activeTasks) {
        for (const [ key, activeCase ] of taskRun.state.activeCases) {
            activeState.addActiveCase(key, activeCase, activeCase.startedAtMicroseconds);
        }
    }

    return activeState;
}

function stopTaskForResourceExhaustion(taskRun: WorkerPoolTaskRun, runtime: WorkerPoolRunRuntime): void {
    taskRun.endedByParent.write(true);
    taskRun.requeuePendingCases.write(false);
    taskRun.state.recordTerminalActiveCases(
        'resource-exhausted',
        runtime.dependencies.wallClock.currentMonotonicMicroseconds
    );
    clearTaskTimeout(taskRun, runtime);
    taskRun.controller.abort();
}

function stopActiveTasksForResourceExhaustion(runtime: WorkerPoolRunRuntime): void {
    for (const taskRun of runtime.activeTasks) {
        stopTaskForResourceExhaustion(taskRun, runtime);
    }
}

function recordPoolResourceBreach(runtime: WorkerPoolRunRuntime, sample: PoolResourceUsageSample): void {
    const breach = findResourceBudgetBreach(
        poolResourceBudgets(runtime),
        sample,
        runtime.previousPoolSample.read()
    );
    runtime.previousPoolSample.write(sample);

    if (breach !== null) {
        runtime.terminalFailure.write(true);
        const activeState = createActiveCaseState(runtime);
        const error = resourceExhaustionError(breach, activeState);
        runtime.runState.recordRunnerError(error);
        runtime.reporterEvents.add(recordReporterEventErrors({ error, kind: 'runner-error' }, runtime));
        stopActiveTasksForResourceExhaustion(runtime);
    }
}

export async function startPoolResourceTracking(runtime: WorkerPoolRunRuntime): Promise<void> {
    runtime.poolResourceUsageTracker?.start(function recordPoolSample(sample) {
        if (!runtime.terminalFailure.read()) {
            recordPoolResourceBreach(runtime, sample);
        }
    });
    await runtime.poolResourceUsageTracker?.waitForStart?.();
}

export async function reportRunStart(
    runtime: WorkerPoolRunRuntime,
    startedAtMilliseconds: number
): Promise<void> {
    if (runtime.resolvedRun.facts.execution.placementPlan?.units.length === 0) {
        return;
    }

    await recordReporterEventErrors({
        facts: runtime.resolvedRun.facts,
        kind: 'run-start',
        root: {
            annotations: runtime.collectedPlan.root.annotations,
            title: runtime.collectedPlan.root.title
        },
        startedAt: runStartTimeFromMilliseconds(startedAtMilliseconds)
    }, runtime);
}
