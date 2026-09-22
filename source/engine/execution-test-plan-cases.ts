import {
    caseWithAsyncLeakPolicy,
    concurrentRunActiveResourceLeak,
    type AsyncLeakCheckedCase,
    type AsyncLeakDependencies
} from './execution-async-leak-policy.ts';
import type { NormalizedExecuteOptions } from './execution-options.ts';
import {
    executeCaseBody,
    type ConcurrentCase,
    type ExecutionSupervision,
    type ExecutionSupervisionDependencies
} from './execution-supervision.ts';
import type { ReporterDelivery } from './reporter-dispatcher.ts';
import {
    createReporterEventQueue,
    reportSuiteTransition,
    type ReporterEventQueue
} from './reporter-event-queue.ts';
import {
    reportRunnerErrorEvents,
    unreportedRunnerErrors
} from './runner-error-reporting.ts';
import type { PerTestResult, RunnerError } from './run-result.ts';
import type { TestPlan, TestPlanCase } from './test-plan.ts';

export type ExecutionCaseDependencies = AsyncLeakDependencies & ExecutionSupervisionDependencies;

export type ExecutedTestPlan = {
    readonly perTest: readonly PerTestResult[];
    readonly reporterErrors: readonly RunnerError[];
    readonly testExecutionWallTimeMicroseconds: number;
};

type ReportedCase = {
    readonly executionWindow: TimingWindow;
    readonly reporterErrors: readonly RunnerError[];
    readonly runnerErrors: readonly RunnerError[];
    readonly result: PerTestResult;
};

type ConcurrentCaseExecution = {
    readonly endReporterErrors: readonly RunnerError[];
    readonly perTest: readonly PerTestResult[];
    readonly reportedRunnerErrors: readonly RunnerError[];
    readonly runnerErrors: readonly RunnerError[];
    readonly testExecutionWallTimeMicroseconds: number;
};

type TimingWindow = {
    readonly endedAtMicroseconds: number;
    readonly startedAtMicroseconds: number;
};

type ReportTestEndInput = {
    readonly attempt: number;
    readonly result: PerTestResult;
    readonly testCase: TestPlanCase;
    readonly durationMicroseconds: number;
};

type ExecutionReportingContext = {
    readonly dependencies: ExecutionCaseDependencies;
    readonly reporterDelivery: ReporterDelivery;
};

type ExecuteCaseInput = {
    readonly attempt: number;
    readonly context: ExecutionReportingContext;
    readonly options: NormalizedExecuteOptions;
    readonly supervision: ExecutionSupervision;
    readonly testCase: TestPlanCase;
};

type TimedLeakCheckedCase = {
    readonly endedAtMicroseconds: number;
    readonly leakCheckedCase: AsyncLeakCheckedCase;
    readonly startedAtMicroseconds: number;
};

export type ExecuteTestPlanCasesInput = {
    readonly context: ExecutionReportingContext;
    readonly options: NormalizedExecuteOptions;
    readonly supervision: ExecutionSupervision;
    readonly testPlan: TestPlan;
};

type SerialCaseExecutionState = {
    readonly currentSuitePath: TestPlanCase['suitePath'];
    readonly perTest: readonly PerTestResult[];
    readonly reportedRunnerErrors: readonly RunnerError[];
    readonly reporterErrors: readonly RunnerError[];
    readonly timingWindows: readonly TimingWindow[];
};

type ExecuteConcurrentCasesInput = {
    readonly context: ExecutionReportingContext;
    readonly options: NormalizedExecuteOptions;
    readonly reportQueue: ReporterEventQueue;
    readonly supervision: ExecutionSupervision;
    readonly testPlan: TestPlan;
};

async function reportTestStart(
    testCase: TestPlanCase,
    attempt: number,
    context: ExecutionReportingContext
): Promise<readonly RunnerError[]> {
    return await context.reporterDelivery.reportEvent({
        attempt,
        case: testCase.id,
        definitionLocations: testCase.definitionLocations,
        kind: 'test-start',
        suitePath: testCase.suitePath,
        workId: testCase.workId
    });
}

async function reportTestEnd(
    input: ReportTestEndInput,
    context: ExecutionReportingContext
): Promise<readonly RunnerError[]> {
    return await context.reporterDelivery.reportEvent({
        attempt: input.attempt,
        artifacts: [],
        case: input.testCase.id,
        definitionLocations: input.testCase.definitionLocations,
        kind: 'test-end',
        outcome: input.result.outcome,
        suitePath: input.testCase.suitePath,
        verdict: input.result.verdict,
        durationMicroseconds: input.durationMicroseconds,
        workId: input.testCase.workId
    });
}

async function executeTimedLeakCheckedCase(input: ExecuteCaseInput): Promise<TimedLeakCheckedCase> {
    const activeResourceTypesBefore = input.context.dependencies.readActiveResourceTypes();
    const startedAtMicroseconds = input.context.dependencies.wallClock.currentMonotonicMicroseconds;
    const executedCase = await input.context.dependencies.asyncLeakMonitor.runCase(
        input.testCase,
        async function runCase() {
            return await input.context.dependencies.globalErrorObserver.runCase(
                input.testCase,
                async function runObservedCase() {
                    return await executeCaseBody(
                        input.testCase,
                        input.options.timeoutPolicy,
                        input.supervision,
                        input.context.dependencies
                    );
                }
            );
        }
    );
    const leakCheckedCase = await caseWithAsyncLeakPolicy({
        activeResourceTypesBefore,
        dependencies: input.context.dependencies,
        executedCase,
        includeActiveResourceLeaks: input.options.execution.mode === 'serial-in-process',
        testCase: input.testCase
    });

    return {
        endedAtMicroseconds: input.context.dependencies.wallClock.currentMonotonicMicroseconds,
        leakCheckedCase,
        startedAtMicroseconds
    };
}

async function executeCase(input: ExecuteCaseInput): Promise<ReportedCase> {
    const startErrors = await reportTestStart(input.testCase, input.attempt, input.context);
    const { endedAtMicroseconds, leakCheckedCase, startedAtMicroseconds } = await executeTimedLeakCheckedCase(input);
    const caseRunnerErrors = [
        ...input.context.dependencies.globalErrorObserver.takeErrors(),
        ...leakCheckedCase.executedCase.runnerErrors,
        ...leakCheckedCase.runnerErrors
    ];

    for (const runnerError of caseRunnerErrors) {
        input.supervision.recordRunnerError(runnerError);
    }

    const runnerErrorNotificationErrors = await reportRunnerErrorEvents(
        input.context.reporterDelivery,
        caseRunnerErrors
    );
    const endErrors = await reportTestEnd(
        {
            attempt: input.attempt,
            result: leakCheckedCase.executedCase.result,
            testCase: input.testCase,
            durationMicroseconds: leakCheckedCase.executedCase.durationMicroseconds
        },
        input.context
    );

    return {
        executionWindow: { endedAtMicroseconds, startedAtMicroseconds },
        reporterErrors: [ ...startErrors, ...runnerErrorNotificationErrors, ...endErrors ],
        runnerErrors: caseRunnerErrors,
        result: leakCheckedCase.executedCase.result
    };
}

function initialSerialCaseExecutionState(): SerialCaseExecutionState {
    return {
        currentSuitePath: [],
        perTest: [],
        reportedRunnerErrors: [],
        reporterErrors: [],
        timingWindows: []
    };
}

function testExecutionWallTimeMicroseconds(timingWindows: readonly TimingWindow[]): number {
    const starts = timingWindows.map(function toStart(window) {
        return window.startedAtMicroseconds;
    });
    const ends = timingWindows.map(function toEnd(window) {
        return window.endedAtMicroseconds;
    });

    return starts.length === 0 || ends.length === 0
        ? 0
        : Math.max(0, Math.max(...ends) - Math.min(...starts));
}

async function executeSerialTestPlanCase(
    input: ExecuteTestPlanCasesInput,
    state: SerialCaseExecutionState,
    testCase: TestPlanCase
): Promise<SerialCaseExecutionState> {
    const suiteErrors = await reportSuiteTransition(
        input.context.reporterDelivery,
        state.currentSuitePath,
        testCase.suitePath
    );
    const testRun = await executeCase({
        attempt: 0,
        context: input.context,
        options: input.options,
        supervision: input.supervision,
        testCase
    });

    return {
        currentSuitePath: testCase.suitePath,
        perTest: [ ...state.perTest, testRun.result ],
        reportedRunnerErrors: [ ...state.reportedRunnerErrors, ...testRun.runnerErrors ],
        reporterErrors: [ ...state.reporterErrors, ...suiteErrors, ...testRun.reporterErrors ],
        timingWindows: [ ...state.timingWindows, testRun.executionWindow ]
    };
}

async function serialTestPlanReporterErrors(
    input: ExecuteTestPlanCasesInput,
    state: SerialCaseExecutionState
): Promise<readonly RunnerError[]> {
    const pendingRunnerErrors = unreportedRunnerErrors(input.supervision.runnerErrors, state.reportedRunnerErrors);
    const pendingRunnerErrorNotifications = await reportRunnerErrorEvents(
        input.context.reporterDelivery,
        pendingRunnerErrors
    );

    return [
        ...state.reporterErrors,
        ...input.supervision.runnerErrors,
        ...pendingRunnerErrorNotifications,
        ...await reportSuiteTransition(
            input.context.reporterDelivery,
            state.currentSuitePath,
            []
        )
    ];
}

async function executeTestPlanCases(input: ExecuteTestPlanCasesInput): Promise<ExecutedTestPlan> {
    let state = initialSerialCaseExecutionState();

    for (const testCase of input.testPlan.cases) {
        if (input.context.dependencies.globalErrorObserver.hasFatalError()) {
            break;
        }

        state = await executeSerialTestPlanCase(input, state, testCase);
    }

    return {
        perTest: state.perTest,
        reporterErrors: await serialTestPlanReporterErrors(input, state),
        testExecutionWallTimeMicroseconds: testExecutionWallTimeMicroseconds(state.timingWindows)
    };
}

async function reportConcurrentCaseStarts(input: ExecuteTestPlanCasesInput): Promise<readonly RunnerError[]> {
    let reporterErrors: readonly RunnerError[] = [];
    let currentSuitePath: TestPlanCase['suitePath'] = [];

    for (const testCase of input.testPlan.cases) {
        const suiteErrors = await reportSuiteTransition(
            input.context.reporterDelivery,
            currentSuitePath,
            testCase.suitePath
        );
        const startErrors = await reportTestStart(testCase, 0, input.context);
        currentSuitePath = testCase.suitePath;
        reporterErrors = [ ...reporterErrors, ...suiteErrors, ...startErrors ];
    }

    return [
        ...reporterErrors,
        ...await reportSuiteTransition(input.context.reporterDelivery, currentSuitePath, [])
    ];
}

async function reportConcurrentCaseEnd(
    testCase: TestPlanCase,
    executedCase: ConcurrentCase,
    reportQueue: ReporterEventQueue
): Promise<readonly RunnerError[]> {
    return await reportQueue.report({
        attempt: 0,
        artifacts: [],
        case: testCase.id,
        definitionLocations: testCase.definitionLocations,
        kind: 'test-end',
        outcome: executedCase.result.outcome,
        suitePath: testCase.suitePath,
        verdict: executedCase.result.verdict,
        durationMicroseconds: executedCase.durationMicroseconds,
        workId: testCase.workId
    });
}

async function reportConcurrentCaseRunnerErrors(
    runnerErrors: readonly RunnerError[],
    reportQueue: ReporterEventQueue
): Promise<readonly RunnerError[]> {
    let reporterErrors: readonly RunnerError[] = [];

    for (const error of runnerErrors) {
        reporterErrors = [
            ...reporterErrors,
            ...await reportQueue.report({
                error,
                kind: 'runner-error'
            })
        ];
    }

    return reporterErrors;
}

async function executeConcurrentCases(input: ExecuteConcurrentCasesInput): Promise<ConcurrentCaseExecution> {
    const endReporterErrors: RunnerError[] = [];
    const reportedRunnerErrors: RunnerError[] = [];
    const caseExecutions = input.testPlan.cases.map(async function executeCaseConcurrently(testCase) {
        const startedAtMicroseconds = input.context.dependencies.wallClock.currentMonotonicMicroseconds;
        const executedCase = await input.context.dependencies.asyncLeakMonitor.runCase(
            testCase,
            async function runCase() {
                return await input.context.dependencies.globalErrorObserver.runCase(
                    testCase,
                    async function runObservedCase() {
                        return await executeCaseBody(
                            testCase,
                            input.options.timeoutPolicy,
                            input.supervision,
                            input.context.dependencies
                        );
                    }
                );
            }
        );
        const leakCheckedCase = await caseWithAsyncLeakPolicy({
            activeResourceTypesBefore: [],
            dependencies: input.context.dependencies,
            executedCase,
            includeActiveResourceLeaks: false,
            testCase
        });
        const endedAtMicroseconds = input.context.dependencies.wallClock.currentMonotonicMicroseconds;
        const caseRunnerErrors = [
            ...input.context.dependencies.globalErrorObserver.takeErrors(),
            ...leakCheckedCase.executedCase.runnerErrors,
            ...leakCheckedCase.runnerErrors
        ];

        for (const runnerError of caseRunnerErrors) {
            input.supervision.recordRunnerError(runnerError);
        }

        endReporterErrors.push(
            ...await reportConcurrentCaseRunnerErrors(
                caseRunnerErrors,
                input.reportQueue
            ),
            ...await reportConcurrentCaseEnd(testCase, leakCheckedCase.executedCase, input.reportQueue)
        );
        reportedRunnerErrors.push(...caseRunnerErrors);

        return {
            executedCase: leakCheckedCase.executedCase,
            executionWindow: { endedAtMicroseconds, startedAtMicroseconds }
        };
    });
    const executedCases = await Promise.all(caseExecutions);

    return {
        endReporterErrors,
        perTest: executedCases.map(function toPerTest(executedCase) {
            return executedCase.executedCase.result;
        }),
        reportedRunnerErrors,
        runnerErrors: input.supervision.runnerErrors,
        testExecutionWallTimeMicroseconds: testExecutionWallTimeMicroseconds(
            executedCases.map(function toWindow(executedCase) {
                return executedCase.executionWindow;
            })
        )
    };
}

async function fatalConcurrentStartResult(
    input: ExecuteTestPlanCasesInput,
    reporterErrors: readonly RunnerError[]
): Promise<ExecutedTestPlan> {
    const pendingRunnerErrors = input.context.dependencies.globalErrorObserver.takeErrors();
    const pendingRunnerErrorNotifications = await reportRunnerErrorEvents(
        input.context.reporterDelivery,
        pendingRunnerErrors
    );

    return {
        perTest: [],
        reporterErrors: [
            ...reporterErrors,
            ...pendingRunnerErrors,
            ...pendingRunnerErrorNotifications
        ]
    };
}

async function executeConcurrentTestPlanCases(input: ExecuteTestPlanCasesInput): Promise<ExecutedTestPlan> {
    const reporterErrors = await reportConcurrentCaseStarts(input);
    if (input.context.dependencies.globalErrorObserver.hasFatalError()) {
        return await fatalConcurrentStartResult(input, reporterErrors);
    }

    const activeResourceTypesBefore = input.context.dependencies.readActiveResourceTypes();
    const concurrentCaseExecution = await executeConcurrentCases({
        context: input.context,
        options: input.options,
        reportQueue: createReporterEventQueue(input.context.reporterDelivery),
        supervision: input.supervision,
        testPlan: input.testPlan
    });
    const activeLeakError = concurrentRunActiveResourceLeak(
        input.context.dependencies,
        activeResourceTypesBefore
    );
    const runnerErrors = activeLeakError === null
        ? concurrentCaseExecution.runnerErrors
        : [ ...concurrentCaseExecution.runnerErrors, activeLeakError ];
    const pendingRunnerErrors = unreportedRunnerErrors(runnerErrors, concurrentCaseExecution.reportedRunnerErrors);
    const pendingRunnerErrorNotifications = await reportRunnerErrorEvents(
        input.context.reporterDelivery,
        pendingRunnerErrors
    );

    return {
        perTest: concurrentCaseExecution.perTest,
        reporterErrors: [
            ...reporterErrors,
            ...runnerErrors,
            ...pendingRunnerErrorNotifications,
            ...concurrentCaseExecution.endReporterErrors
        ],
        testExecutionWallTimeMicroseconds: concurrentCaseExecution.testExecutionWallTimeMicroseconds
    };
}

export async function executeTestPlanCasesWithMode(
    input: ExecuteTestPlanCasesInput
): Promise<ExecutedTestPlan> {
    if (input.options.execution.mode === 'concurrent-in-process') {
        return await executeConcurrentTestPlanCases(input);
    }

    return await executeTestPlanCases(input);
}
