import { withDebugAttempt } from './test-debug-context.ts';
import { caseExecutionArtifacts } from './execution-observation.ts';
import type { CaseReportingContext, ExecuteCaseInput, ReportedCase } from './case-attempt-context.ts';
import { observeCaseBody, type ObservedCaseBody } from './case-body-observation.ts';
import {
    completeCaseWithAsyncLeakPolicy
} from './execution-async-leak-policy.ts';
import type { ReporterDelivery } from './reporter-dispatcher.ts';
import { reportRunnerErrorEvents } from './runner-error-reporting.ts';
import type { PerTestResult, RunnerError, TestContractFailure } from './run-result.ts';
import { retryPolicyAllowsAttempt } from './retry-policy.ts';
import { appendAttempt, resourceCheckedAttemptResult, caseResultWithPolicyErrors } from './case-attempt-result.ts';

export type ExecutionCaseDependencies = CaseReportingContext['dependencies'];

type ReportTestEndInput = {
    readonly completion: 'final' | 'retry';
    readonly attempt: number;
    readonly result: PerTestResult;
    readonly testCase: ExecuteCaseInput['testCase'];
    readonly durationMicroseconds: number;
};

export async function reportTestStart(
    testCase: ExecuteCaseInput['testCase'],
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
        property: input.result.property,
        benchmark: input.result.benchmark,
        attempt: input.attempt,
        artifacts: caseExecutionArtifacts(input.testCase.workId, { index: input.attempt }),
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

function attributeCaseAttempt(input: ExecuteCaseInput, errors: readonly RunnerError[]): readonly RunnerError[] {
    return errors.map(function attributeAttempt(error) {
        return error.attributedToWork === input.testCase.workId && error.attributedToAttempt === null
            ? { ...error, attributedToAttempt: { index: input.attempt } }
            : error;
    });
}

async function executeAttempt(
    input: ExecuteCaseInput,
    started: boolean,
    body: ObservedCaseBody
): Promise<ReportedCase> {
    const startErrors = started ? [] : await reportTestStart(
        input.testCase,
        input.attempt,
        input.context.reporterDelivery
    );
    const { endedAtMicroseconds, leakCheckedCase, startedAtMicroseconds } = await body.run();
    const caseRunnerErrors = attributeCaseAttempt(input, [
        ...input.context.dependencies.globalErrorObserver.takeErrors(),
        ...leakCheckedCase.executedCase.runnerErrors,
        ...leakCheckedCase.runnerErrors
    ]);

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
        result: await resourceCheckedAttemptResult(leakCheckedCase.executedCase.result, input)
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
    const errors = attributeCaseAttempt(
        input,
        await completeCaseWithAsyncLeakPolicy({
            dependencies: input.context.dependencies,
            includeActiveResourceLeaks: input.options.execution.mode === 'serial-in-process',
            testCase: input.testCase,
            async complete() {
                return await completionErrors(input, policy);
            }
        })
    );
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
        result: caseResultWithPolicyErrors(executed.result, errors)
    };
}

function retainLateAssertionFailures(
    executed: ReportedCase,
    lateFailures: readonly TestContractFailure[]
): ReportedCase {
    const { result } = executed;
    const current = result.outcome?.kind === 'fail' ? result.outcome.failures : [];
    const failures = Array.from(new Set([ ...current, ...lateFailures ]));
    const [ first, ...rest ] = failures;
    if (first === undefined || failures.length === current.length) {
        return executed;
    }
    const outcome = { kind: 'fail', failures: [ first, ...rest ] } as const;
    const verdict = [ 'pass', 'inconclusive' ].includes(result.verdict) ? 'fail' : result.verdict;
    return {
        ...executed,
        result: { ...result, outcome, verdict, attempts: [ { ...result.attempts[0], outcome, verdict } ] }
    };
}

async function finishAttempt(input: ExecuteCaseInput, executed: ReportedCase, retry: boolean): Promise<ReportedCase> {
    const completed = executed;
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
        const current = chain;
        const { retry, completed } = await input.context.dependencies.globalErrorObserver.runCase(
            current.current.testCase,
            { index: current.current.attempt },
            async function observeCompleteAttempt() {
                const body = observeCaseBody(current.current);
                const observed = await withDebugAttempt(current.current, async function runAttempt() {
                    const executed = retainLateAssertionFailures(
                        await executeAttempt(current.current, current.started, body),
                        body.lateFailures()
                    );
                    const retryAllowed = canRetryCase(current.current, executed);
                    const attemptResult = retryAllowed
                        ? executed
                        : await completeLogicalCase(current.current, executed);
                    return { retry: retryAllowed, completed: attemptResult };
                }, function result(value) {
                    return value.completed.result;
                });
                let attempt = retainLateAssertionFailures(observed.completed, body.lateFailures());
                const willRetry = observed.retry && canRetryCase(current.current, attempt);
                if (observed.retry && !willRetry) {
                    attempt = retainLateAssertionFailures(
                        await completeLogicalCase(current.current, attempt),
                        body.lateFailures()
                    );
                }
                body.publish();
                return { retry: willRetry, completed: await finishAttempt(current.current, attempt, willRetry) };
            }
        );
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
