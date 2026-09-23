import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type PerTestResult,
    type ReporterEvent,
    type RunnerError,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { createSupervisedRunState } from './supervised-run-state.ts';
import type { WorkerPoolWorkDispatcher } from './worker-pool-dispatch-state.ts';
import {
    createCollectedPlan,
    createTaskRun,
    fakeWorkerRuntime
} from './worker-pool-execution-state.test.ts';
import { handleWorkerMessage, recordTaskPermissionFailure } from './worker-pool-task-events.ts';
import type { WorkerPoolMessage } from './worker-pool-protocol.ts';
import type { WorkerPoolRunRuntime, WorkerPoolTaskRun } from './worker-pool-runtime.ts';

type PermissionFailureContext = {
    readonly dispatcher: WorkerPoolWorkDispatcher;
    readonly runtime: WorkerPoolRunRuntime;
    readonly stopActiveTasks: (excludedTask: WorkerPoolTaskRun | null) => void;
};
type RunLevelPermissionFailure = {
    readonly actions: readonly string[];
    readonly recorded: boolean;
    readonly runnerError: RunnerError | undefined;
    readonly terminalFailure: boolean;
};

const integrationPath = 'source/integration-tests/run/fixtures/passing.test.ts';
const testCaseMetadata = {
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' as const } ]
} as const;

function firstCaseId(): PerTestResult['id'] {
    return {
        file: integrationPath,
        params: null,
        suite: [ 'integration' ],
        title: 'first'
    };
}

function passResult(): PerTestResult {
    const id = firstCaseId();

    return {
        id,
        outcome: { kind: 'pass' },
        verdict: 'pass',
        durationMicroseconds: 0,
        workId: { case: id, runtimes: [], workload: null }
    };
}

function startEvent(): Extract<ReporterEvent, { readonly kind: 'test-start'; }> {
    return {
        attempt: 1,
        case: firstCaseId(),
        definitionLocations: [ { kind: 'unknown' } ],
        kind: 'test-start',
        suitePath: [ { definitionLocations: [ { kind: 'unknown' } ], title: 'integration' } ],
        workId: passResult().workId
    };
}

function startEventWithoutWorkId(): Extract<ReporterEvent, { readonly kind: 'test-start'; }> {
    return {
        attempt: 1,
        case: firstCaseId(),
        definitionLocations: [ { kind: 'unknown' } ],
        kind: 'test-start',
        suitePath: [ { definitionLocations: [ { kind: 'unknown' } ], title: 'integration' } ]
    };
}

function endEventWithoutWorkId(): Extract<ReporterEvent, { readonly kind: 'test-end'; }> {
    return {
        ...startEventWithoutWorkId(),
        artifacts: [],
        kind: 'test-end',
        outcome: { kind: 'pass' },
        verdict: 'pass',
        durationMicroseconds: 0
    };
}

function eventMessage(event: ReporterEvent): WorkerPoolMessage {
    return { event, kind: 'event' };
}

function taskRunWithLane(lane: string): WorkerPoolTaskRun {
    return {
        ...createTaskRun(createSupervisedRunState()),
        lane,
        reporterEventsBuffered: true
    };
}

function hedgedRuntime(): WorkerPoolRunRuntime {
    return fakeWorkerRuntime(createCollectedPlan());
}

function reporterError(): RunnerError {
    return {
        attributedTo: null,
        cause: new Error('reporter failed'),
        message: 'Reporter failed.',
        subtype: 'reporter'
    };
}

function runtimeWithReporterEventErrors(): WorkerPoolRunRuntime {
    const runtime = hedgedRuntime();
    const pending: Promise<void>[] = [];

    return {
        ...runtime,
        reporterDelivery: {
            ...runtime.reporterDelivery,
            async reportEvent() {
                return [ reporterError() ];
            }
        },
        reporterEvents: {
            add(eventDelivery) {
                pending.push(eventDelivery);
            },
            async wait() {
                await Promise.all(pending);
            }
        }
    };
}

function accessDeniedError(): Error {
    return Object.assign(new Error('denied'), {
        code: 'ERR_ACCESS_DENIED',
        permission: 'FileSystemRead',
        resource: '/project/input.txt'
    });
}

function permissionFailureContext(
    runtime: WorkerPoolRunRuntime,
    recordAction: (action: string) => void
): PermissionFailureContext {
    return {
        dispatcher: {
            blocked() {
                return false;
            },
            clear() {
                recordAction('clear');
            },
            finish() {
                return undefined;
            },
            pull() {
                return null;
            },
            requeue() {
                return undefined;
            },
            async waitForChange() {
                return undefined;
            }
        },
        runtime,
        stopActiveTasks() {
            recordAction('stop');
        }
    };
}

function recordPermissionFailureForTask(taskRun: WorkerPoolTaskRun, runtime: WorkerPoolRunRuntime): boolean {
    return recordTaskPermissionFailure(
        accessDeniedError(),
        taskRun,
        permissionFailureContext(runtime, function ignoreAction() {
            return undefined;
        })
    );
}

function runLevelPermissionFailure(): RunLevelPermissionFailure {
    const runtime = hedgedRuntime();
    const taskRun = taskRunWithLane('worker-1');
    const actions: string[] = [];
    const recordAction = function recordAction(action: string): void {
        actions.push(action);
    };
    const recorded = recordTaskPermissionFailure(
        accessDeniedError(),
        taskRun,
        permissionFailureContext(runtime, recordAction)
    );

    return {
        actions,
        recorded,
        runnerError: taskRun.state.runnerErrors()[0],
        terminalFailure: runtime.terminalFailure.read()
    };
}

async function reportedWorkerEventErrors(): Promise<WorkerPoolRunRuntime> {
    const runtime = runtimeWithReporterEventErrors();

    handleWorkerMessage(
        eventMessage({ kind: 'suite-start', suitePath: [] }),
        createTaskRun(createSupervisedRunState()),
        runtime
    );
    await runtime.reporterEvents.wait();

    return runtime;
}

export const testNode = createOverkillSuite({
    ...testCaseMetadata,
    title: 'source/run/worker-pool-task-events.test.ts',
    children: [
        createOverkillTestCase({
            ...testCaseMetadata,
            title: 'worker-pool task events buffer starts and clear completed timeouts',
            body(scope: OverkillScope) {
                const runtime = hedgedRuntime();
                const taskRun = taskRunWithLane('worker-1');

                handleWorkerMessage(eventMessage(startEventWithoutWorkId()), taskRun, runtime);
                handleWorkerMessage(eventMessage(startEvent()), taskRun, runtime);
                handleWorkerMessage(eventMessage(endEventWithoutWorkId()), taskRun, runtime);

                scope.assert.equal(taskRun.timeout.read(), null);
                scope.assert.equal(Array.from(taskRun.bufferedReporterEvents).length, 3);
                scope.assert.equal(taskRun.startedCases.size, 1);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            ...testCaseMetadata,
            title: 'worker-pool task events record reporter delivery errors',
            async body(scope: OverkillScope) {
                const runtime = await reportedWorkerEventErrors();

                scope.assert.equal(runtime.runState.runnerErrors()[0]?.message, 'Reporter failed.');

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            ...testCaseMetadata,
            title: 'worker-pool task events keep active trace for unrelated completed units',
            body(scope: OverkillScope) {
                const runtime = hedgedRuntime();
                const taskRun = taskRunWithLane('worker-1');
                const activeTraceUnit = taskRun.traceUnit;

                handleWorkerMessage(
                    {
                        kind: 'unit-started',
                        traceUnit: activeTraceUnit
                    },
                    taskRun,
                    runtime
                );
                handleWorkerMessage(
                    {
                        durationMicroseconds: 7,
                        kind: 'unit-completed',
                        traceUnit: { ...activeTraceUnit }
                    },
                    taskRun,
                    runtime
                );

                scope.assert.equal(taskRun.activeTraceUnit.read(), activeTraceUnit);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            ...testCaseMetadata,
            title: 'worker-pool task events ignore ordinary task errors for permission handling',
            body(scope: OverkillScope) {
                const runtime = hedgedRuntime();
                const taskRun = taskRunWithLane('worker-1');
                const actions: string[] = [];

                const recorded = recordTaskPermissionFailure(
                    new Error('ordinary failure'),
                    taskRun,
                    permissionFailureContext(runtime, function recordAction(action) {
                        actions.push(action);
                    })
                );

                scope.assert.equal(recorded, false);
                scope.assert.deepEqual(taskRun.state.runnerErrors(), []);
                scope.assert.deepEqual(actions, []);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            ...testCaseMetadata,
            title: 'worker-pool task events record run-level permission task failures',
            body(scope: OverkillScope) {
                const failure = runLevelPermissionFailure();

                scope.assert.equal(failure.recorded, true);
                scope.assert.equal(failure.runnerError?.attributedTo, null);
                scope.assert.equal(failure.runnerError?.subtype, 'permission');
                scope.assert.equal(failure.terminalFailure, true);
                scope.assert.deepEqual(failure.actions, [ 'clear', 'stop' ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            ...testCaseMetadata,
            title: 'worker-pool task events attribute permission task failures to the active case',
            body(scope: OverkillScope) {
                const runtime = hedgedRuntime();
                const taskRun = taskRunWithLane('worker-1');
                const activeCase = firstCaseId();

                taskRun.state.addActiveCase('active', { capture: null, id: activeCase }, 0);
                scope.assert.equal(recordPermissionFailureForTask(taskRun, runtime), true);
                scope.assert.equal(
                    JSON.stringify(taskRun.state.runnerErrors()[0]?.attributedToWork),
                    JSON.stringify(passResult().workId)
                );
                scope.assert.equal(taskRun.state.runnerErrors()[0]?.attributedTo, activeCase);

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
