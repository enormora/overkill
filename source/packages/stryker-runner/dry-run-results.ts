import { inspect } from 'node:util';
import {
    DryRunStatus,
    TestStatus,
    type DryRunOptions,
    type DryRunResult,
    type TestResult
} from '@stryker-mutator/api/test-runner';
import { workIdentityKey, type PerTestResult, type RunExecutionReply } from '../run/run.entry-point.ts';
import { canonicalWork, mutationLifecycleDataSchema } from './mutation-catalog.ts';
import { mutationObservationError, type MutationInvocationExpectation } from './mutation-observation.ts';
import { isInterruptedExecution, isTimeoutInterruption } from './mutation-timeout.ts';
import { hasMutationExecutionError } from './mutation-diagnostics.ts';

type ResultReply = Extract<RunExecutionReply, { readonly kind: 'result'; }>;
type LifecycleData = Readonly<ReturnType<typeof mutationLifecycleDataSchema.parse>>;
export type DryRunExpectation = Extract<MutationInvocationExpectation, { readonly kind: 'dry'; }>;
const microsecondsPerMillisecond = 1000;

function invalidDryRunCase(result: PerTestResult): boolean {
    if (![ 'pass', 'fail', 'skip' ].includes(result.verdict) || result.verdict !== result.outcome?.kind) {
        return true;
    }
    if (result.outcome.kind === 'fail') {
        return result.outcome.failures.some(function infrastructureFailure(failure) {
            return ![ 'assertion', 'body-error', 'test-contract', 'timeout' ].includes(failure.kind);
        });
    }
    return false;
}

function timedOut(result: PerTestResult): boolean {
    return result.outcome?.kind === 'fail' && result.outcome.failures.some(function timeoutFailure(failure) {
        return failure.kind === 'timeout';
    });
}

function failureMessage(result: PerTestResult): string {
    return inspect(result.outcome, { depth: 4, maxArrayLength: null, breakLength: Number.POSITIVE_INFINITY });
}

function mutationTestResult(root: string, result: PerTestResult): TestResult {
    const work = canonicalWork(root, result.workId);
    const common = {
        id: workIdentityKey(work),
        name: [ ...work.case.suite, work.case.title, ...work.case.params === null ? [] : [ work.case.params ] ].join(
            ' > '
        ),
        timeSpentMs: result.durationMicroseconds / microsecondsPerMillisecond,
        ...work.case.file === null ? {} : { fileName: work.case.file }
    };
    if (result.verdict === 'skip') {
        return { ...common, status: TestStatus.Skipped };
    }
    return result.verdict === 'pass'
        ? { ...common, status: TestStatus.Success }
        : { ...common, status: TestStatus.Failed, failureMessage: failureMessage(result) };
}

function dryRunDiagnostic(
    root: string,
    reply: ResultReply,
    expectation: DryRunExpectation
): string | null {
    const observation = mutationObservationError(root, reply, expectation);
    if (observation !== null) {
        return observation;
    }
    const diagnostics = [
        ...reply.result.runnerErrors.map(function runnerDiagnostic(error) {
            return error.message;
        }),
        ...reply.result.perTest.filter(invalidDryRunCase).map(function caseDiagnostic(result) {
            const id = workIdentityKey(canonicalWork(root, result.workId));
            return `${id}: ${failureMessage(result)}`;
        })
    ];
    if (diagnostics.length === 0) {
        return null;
    }
    const message = diagnostics.join('\n');
    return message.length === 0 ? 'Dry run failed.' : message;
}

function fullSuiteCoverage(data: LifecycleData): LifecycleData['coverage'] {
    const counts: Record<string, number> = { ...data.coverage.static };
    for (const counters of Object.values(data.coverage.perTest)) {
        for (const [ id, count ] of Object.entries(counters)) {
            counts[id] = (counts[id] ?? 0) + count;
        }
    }
    return { static: counts, perTest: {} };
}

function timedOutDryRun(reply: Extract<RunExecutionReply, { readonly kind: 'timeout'; }>): DryRunResult {
    if (reply.data === null) {
        return { status: DryRunStatus.Timeout, reason: 'Dry run exceeded its deadline.' };
    }
    const parsed = mutationLifecycleDataSchema.safeParse(reply.data);
    if (!parsed.success) {
        return { status: DryRunStatus.Error, errorMessage: `Invalid mutation lifecycle data: ${parsed.error.message}` };
    }
    const { data } = parsed;
    return hasMutationExecutionError(data)
        ? {
            status: DryRunStatus.Error,
            errorMessage: [
                ...data.infrastructureErrors,
                ...data.caseFailures.map(function diagnostic(failure) {
                    return failure.message;
                })
            ]
                .join('\n')
        }
        : { status: DryRunStatus.Timeout, reason: 'Dry run exceeded its deadline.' };
}

function interruptedDryRun(reply: ResultReply): DryRunResult {
    const failures = reply.result.runnerErrors.filter(function independentFailure(error) {
        return !isTimeoutInterruption(error);
    });
    return failures.length === 0
        ? timedOutDryRun({ kind: 'timeout', data: reply.data })
        : {
            status: DryRunStatus.Error,
            errorMessage: failures
                .map(function diagnostic(error) {
                    return error.message;
                })
                .join('\n')
        };
}

function completeDryRun(
    root: string,
    reply: ResultReply,
    coverage: DryRunOptions['coverageAnalysis'],
    expectation: DryRunExpectation
): DryRunResult {
    const diagnostic = dryRunDiagnostic(root, reply, expectation);
    if (diagnostic !== null) {
        return { status: DryRunStatus.Error, errorMessage: diagnostic };
    }
    if (reply.deadlineExceeded || reply.result.perTest.some(timedOut)) {
        return { status: DryRunStatus.Timeout, reason: 'Dry run exceeded its deadline or test timeout.' };
    }
    const data = mutationLifecycleDataSchema.parse(reply.data);
    const mutantCoverage = coverage === 'all' ? fullSuiteCoverage(data) : data.coverage;
    return {
        status: DryRunStatus.Complete,
        tests: reply.result.perTest.map(function (result) {
            return mutationTestResult(root, result);
        }),
        ...coverage === 'off' ? {} : { mutantCoverage }
    };
}

export function dryMutationResult(
    root: string,
    reply: RunExecutionReply,
    coverage: DryRunOptions['coverageAnalysis'],
    expectation: DryRunExpectation
): DryRunResult {
    if (reply.kind === 'failure') {
        return { status: DryRunStatus.Error, errorMessage: reply.failure.message };
    }
    if (reply.kind === 'timeout') {
        return timedOutDryRun(reply);
    }
    if (isInterruptedExecution(reply)) {
        return interruptedDryRun(reply);
    }
    return completeDryRun(root, reply, coverage, expectation);
}
