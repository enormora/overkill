import {
    caseWithAsyncLeakPolicy,
    type AsyncLeakCheckedCase,
    type AsyncLeakDependencies
} from './execution-async-leak-policy.ts';
import type { NormalizedExecuteOptions } from './execution-options.ts';
import {
    executeCaseBody,
    type ExecutionSupervision,
    type ExecutionSupervisionDependencies
} from './execution-supervision.ts';
import type { ReporterDelivery } from './reporter-dispatcher.ts';
import { reportRunnerErrorEvents } from './runner-error-reporting.ts';
import type { PerTestResult, RunnerError } from './run-result.ts';
import { retryPolicyAllowsAttempt } from './retry-policy.ts';
import { caseAttemptHistory, resultWithAttemptHistory } from './test-attempt-history.ts';
import type { TestPlanCase } from './test-plan.ts';

export type ExecutionCaseDependencies = AsyncLeakDependencies & ExecutionSupervisionDependencies;

export type ReportedCase = {
    readonly executionWindow: TimingWindow;
    readonly reporterErrors: readonly RunnerError[];
    readonly runnerErrors: readonly RunnerError[];
    readonly result: PerTestResult;
};

export type TimingWindow = {
    readonly endedAtMicroseconds: number;
    readonly startedAtMicroseconds: number;
};

type ReportTestEndInput = {
    readonly completion: 'final' | 'retry';
    readonly attempt: number;
    readonly result: PerTestResult;
    readonly testCase: TestPlanCase;
    readonly durationMicroseconds: number;
};

type CaseReportingContext = {
    readonly dependencies: ExecutionCaseDependencies;
    readonly reporterDelivery: Pick<ReporterDelivery, 'reportEvent'>;
};

export type ExecuteCaseInput = {
    readonly attempt: number;
    readonly context: CaseReportingContext;
    readonly options: NormalizedExecuteOptions;
    readonly supervision: ExecutionSupervision;
    readonly testCase: TestPlanCase;
};

type TimedLeakCheckedCase = {
    readonly endedAtMicroseconds: number;
    readonly leakCheckedCase: AsyncLeakCheckedCase;
    readonly startedAtMicroseconds: number;
};

export async function reportTestStart(
    testCase: TestPlanCase,
    attempt: number,
    reporter: Pick<ReporterDelivery, 'reportEvent'>
): Promise<readonly RunnerError[]> {
    return await reporter.reportEvent({
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
    context: CaseReportingContext
): Promise<readonly RunnerError[]> {
    return await context.reporterDelivery.reportEvent({
        completion: input.completion,
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
    const startedAtMicroseconds = Number(input.context.dependencies.wallClock.currentMonotonicMicroseconds);
    const executedCase = await input.context.dependencies.asyncLeakMonitor.runCase(
        input.testCase,
        async function runCase() {
            return await input.context.dependencies.globalErrorObserver.runCase(
                input.testCase,
                { index: input.attempt },
                async function runObservedCase() {
                    return await executeCaseBody({
                        testCase: input.testCase,
                        timeoutPolicy: input.options.timeoutPolicy,
                        supervision: input.supervision,
                        dependencies: input.context.dependencies,
                        attempt: { index: input.attempt }
                    });
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
        endedAtMicroseconds: Number(input.context.dependencies.wallClock.currentMonotonicMicroseconds),
        leakCheckedCase,
        startedAtMicroseconds
    };
}

async function executeAttempt(input: ExecuteCaseInput, started: boolean): Promise<ReportedCase> {
    const startErrors = started ? [] : await reportTestStart(
        input.testCase,
        input.attempt,
        input.context.reporterDelivery
    );
    const { endedAtMicroseconds, leakCheckedCase, startedAtMicroseconds } = await executeTimedLeakCheckedCase(input);
    const caseRunnerErrors = [
        ...input.context.dependencies.globalErrorObserver.takeErrors(),
        ...leakCheckedCase.executedCase.runnerErrors,
        ...leakCheckedCase.runnerErrors
    ]
        .map(function attributeAttempt(error) {
            return error.attributedToWork === input.testCase.workId && error.attributedToAttempt === null
                ? { ...error, attributedToAttempt: { index: input.attempt } }
                : error;
        });

    for (const runnerError of caseRunnerErrors) {
        input.supervision.recordRunnerError(runnerError);
    }

    const runnerErrorNotificationErrors = await reportRunnerErrorEvents(
        input.context.reporterDelivery,
        caseRunnerErrors
    );
    return {
        executionWindow: { endedAtMicroseconds, startedAtMicroseconds },
        reporterErrors: [ ...startErrors, ...runnerErrorNotificationErrors ],
        runnerErrors: caseRunnerErrors,
        result: {
            ...leakCheckedCase.executedCase.result,
            attempts: [ {
                attempt: { index: input.attempt },
                durationMicroseconds: leakCheckedCase.executedCase.durationMicroseconds,
                outcome: leakCheckedCase.executedCase.result.outcome ??
                    leakCheckedCase.executedCase.result.attempts[0].outcome,
                verdict: leakCheckedCase.executedCase.result.verdict
            } ]
        }
    };
}

function acceptsAnotherAttempt(input: ExecuteCaseInput): boolean {
    return !input.context.dependencies.globalErrorObserver.hasFatalError() && input.supervision.acceptsNewCases();
}

function canRetryCase(input: ExecuteCaseInput, executed: ReportedCase): boolean {
    return retryPolicyAllowsAttempt(input.options.retryPolicy, input.attempt + 1, executed.result.outcome) &&
        executed.result.verdict === 'fail' &&
        executed.runnerErrors.length === 0 &&
        acceptsAnotherAttempt(input);
}

async function completionErrors(
    input: ExecuteCaseInput,
    policy: NonNullable<ExecutionCaseDependencies['runtimePolicy']>
): Promise<readonly RunnerError[]> {
    try {
        await policy.completeCase(input.testCase, { index: input.attempt });
        return policy.takeAttemptErrors(input.testCase, { index: input.attempt });
    } catch (error: unknown) {
        return [ {
            attributedTo: input.testCase.id,
            attributedToWork: input.testCase.workId,
            attributedToAttempt: { index: input.attempt },
            cause: error,
            diagnostics: [],
            message: 'Logical case cleanup failed.',
            subtype: 'runtime-policy'
        }, ...policy.takeAttemptErrors(input.testCase, { index: input.attempt }) ];
    }
}

async function completeLogicalCase(input: ExecuteCaseInput, executed: ReportedCase): Promise<ReportedCase> {
    const policy = input.context.dependencies.runtimePolicy;
    if (input.testCase.execution.kind === 'skip' || policy === null || policy === undefined) {
        return executed;
    }
    const errors = await completionErrors(input, policy);
    for (const error of errors) {
        input.supervision.recordRunnerError(error);
    }
    return {
        ...executed,
        reporterErrors: [
            ...executed.reporterErrors,
            ...await reportRunnerErrorEvents(input.context.reporterDelivery, errors)
        ],
        runnerErrors: [ ...executed.runnerErrors, ...errors ],
        result: errors.length === 0 ? executed.result : { ...executed.result, outcome: null, verdict: 'runtime-policy' }
    };
}

async function finishAttempt(input: ExecuteCaseInput, executed: ReportedCase, retry: boolean): Promise<ReportedCase> {
    const completed = retry ? executed : await completeLogicalCase(input, executed);
    return {
        ...completed,
        reporterErrors: [
            ...completed.reporterErrors,
            ...await reportTestEnd({
                attempt: input.attempt,
                completion: retry ? 'retry' : 'final',
                durationMicroseconds: completed.result.durationMicroseconds,
                result: completed.result,
                testCase: input.testCase
            }, input.context)
        ]
    };
}

function caseHistory(completed: ReportedCase, attempts: readonly PerTestResult[]): ReportedCase {
    return { ...completed, result: caseAttemptHistory(completed.result, attempts) };
}

function appendAttempt(previous: ReportedCase | null, completed: ReportedCase): ReportedCase {
    if (previous === null) {
        return caseHistory(completed, [ completed.result ]);
    }
    return {
        executionWindow: {
            ...completed.executionWindow,
            startedAtMicroseconds: previous.executionWindow.startedAtMicroseconds
        },
        reporterErrors: [ ...previous.reporterErrors, ...completed.reporterErrors ],
        runnerErrors: [ ...previous.runnerErrors, ...completed.runnerErrors ],
        result: resultWithAttemptHistory(completed.result, [
            ...previous.result.attempts,
            ...caseAttemptHistory(completed.result, [ completed.result ]).attempts
        ])
    };
}

export async function executeCase(input: ExecuteCaseInput, started: boolean): Promise<ReportedCase> {
    let chain: {
        readonly current: ExecuteCaseInput;
        readonly started: boolean;
        readonly history: ReportedCase | null;
    } = {
        current: input,
        started,
        history: null
    };
    for (;;) {
        const executed = await executeAttempt(chain.current, chain.started);
        const retry = canRetryCase(chain.current, executed);
        const completed = await finishAttempt(chain.current, executed, retry);
        const history = appendAttempt(
            chain.history,
            retry && !acceptsAnotherAttempt(chain.current)
                ? await completeLogicalCase(chain.current, completed)
                : completed
        );
        if (!retry || !acceptsAnotherAttempt(chain.current)) {
            return history;
        }
        chain = { history, current: { ...chain.current, attempt: chain.current.attempt + 1 }, started: false };
    }
}
