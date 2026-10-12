import type { WorkerPoolCommand } from './worker-pool-protocol.ts';
import {
    runStartTimeFromMilliseconds,
    type WorkerPoolRunRuntime,
    type WorkerPoolTaskRun
} from './worker-pool-runtime.ts';
import {
    findProcessBudgetBreach,
    processExhaustionError
} from './supervised-run-process-policy.ts';
import {
    createSupervisedRunState,
    type SupervisedRunState
} from './supervised-run-state.ts';

type RuntimeReporterEvent = Parameters<WorkerPoolRunRuntime['reporterDelivery']['reportEvent']>[0];
type PoolProcessUsageSample = NonNullable<ReturnType<WorkerPoolRunRuntime['previousPoolSample']['read']>>;

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

function poolProcessBudgets(runtime: WorkerPoolRunRuntime): WorkerPoolCommand['processBudgets'] {
    const { budgets } = runtime.resolvedRun.facts.execution.processUsagePolicy;

    return {
        activeResourceCount: null,
        javaScriptEngineHeapBytes: null,
        residentSetBytes: budgets.residentSetBytes,
        residentSetGrowthBytesPerSecond: budgets.residentSetGrowthBytesPerSecond
    };
}

function createActiveCaseState(runtime: WorkerPoolRunRuntime): SupervisedRunState {
    const activeState = createSupervisedRunState('first-failure-and-final');

    for (const taskRun of runtime.activeTasks) {
        for (const [ key, activeCase ] of taskRun.state.activeCases) {
            activeState.addActiveCase(key, activeCase, activeCase.startedAtMicroseconds, activeCase.attempt);
        }
    }

    return activeState;
}

function stopTaskForProcessExhaustion(taskRun: WorkerPoolTaskRun, runtime: WorkerPoolRunRuntime): void {
    taskRun.endedByParent.write(true);
    taskRun.requeuePendingCases.write(false);
    taskRun.state.recordTerminalActiveCases(
        'process-exhausted',
        Number(runtime.dependencies.wallClock.currentMonotonicMicroseconds)
    );
    clearTaskTimeout(taskRun, runtime);
    taskRun.controller.abort();
}

function stopActiveTasksForProcessExhaustion(runtime: WorkerPoolRunRuntime): void {
    for (const taskRun of runtime.activeTasks) {
        stopTaskForProcessExhaustion(taskRun, runtime);
    }
}

function recordPoolProcessBudgetBreach(runtime: WorkerPoolRunRuntime, sample: PoolProcessUsageSample): void {
    const breach = findProcessBudgetBreach(
        poolProcessBudgets(runtime),
        sample,
        runtime.previousPoolSample.read()
    );
    runtime.previousPoolSample.write(sample);

    if (breach !== null) {
        runtime.terminalFailure.write(true);
        const activeState = createActiveCaseState(runtime);
        const error = processExhaustionError(breach, activeState);
        runtime.runState.recordRunnerError(error);
        runtime.reporterEvents.add(recordReporterEventErrors({ error, kind: 'runner-error' }, runtime));
        stopActiveTasksForProcessExhaustion(runtime);
    }
}

export async function startPoolProcessUsageTracking(runtime: WorkerPoolRunRuntime): Promise<void> {
    runtime.poolProcessUsageTracker?.start(function recordPoolSample(sample) {
        if (!runtime.terminalFailure.read()) {
            recordPoolProcessBudgetBreach(runtime, sample);
        }
    });
    await runtime.poolProcessUsageTracker?.waitForStart?.();
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
