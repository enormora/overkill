import { inspect } from 'node:util';
import {
    MutantRunStatus,
    type MutantRunResult
} from '@stryker-mutator/api/test-runner';
import {
    workIdentityKey,
    type PerTestResult,
    type RunnerError,
    type RunExecutionReply
} from '../run/run.entry-point.ts';
import { canonicalWork, mutationLifecycleDataSchema, type MutationCatalog } from './mutation-catalog.ts';
import { mutationObservationError, type MutationInvocationExpectation } from './mutation-observation.ts';

type ResultReply = Extract<RunExecutionReply, { readonly kind: 'result'; }>;
type LifecycleData = Readonly<ReturnType<typeof mutationLifecycleDataSchema.parse>>;

function errorPhase(error: RunnerError): unknown {
    return typeof error.cause === 'object' && error.cause !== null ? Reflect.get(error.cause, 'phase') : null;
}

function isKillingFailure(
    failure: NonNullable<Extract<PerTestResult['outcome'], { readonly kind: 'fail'; }>>['failures'][number]
): boolean {
    return [ 'assertion', 'body-error', 'test-contract' ].includes(failure.kind);
}

export function safeMutationFailure(root: string, result: PerTestResult, errors: readonly RunnerError[]): boolean {
    if (result.outcome?.kind === 'fail') {
        return result.outcome.failures.every(isKillingFailure);
    }
    const identity = workIdentityKey(canonicalWork(root, result.workId));
    return errors.some(function isCasePolicyFailure(error) {
        const work = error.attributedToWork;
        return work !== undefined && work !== null && workIdentityKey(canonicalWork(root, work)) === identity &&
            [ 'runtime-policy', 'permission' ].includes(error.subtype) && errorPhase(error) === 'body';
    });
}

function infrastructureErrors(
    root: string,
    catalog: MutationCatalog,
    errors: readonly RunnerError[]
): readonly RunnerError[] {
    const eligible = new Set(
        catalog
            .filter(function (entry) {
                return entry.skipReason === null;
            })
            .map(function (entry) {
                return entry.id;
            })
    );
    return errors.filter(function isInfrastructureError(error) {
        const work = error.attributedToWork;
        return work === undefined || work === null || !eligible.has(workIdentityKey(canonicalWork(root, work))) ||
            ![ 'runtime-policy', 'permission' ].includes(error.subtype) || errorPhase(error) !== 'body';
    });
}

function timedOut(result: PerTestResult): boolean {
    return result.outcome?.kind === 'fail' && result.outcome.failures.some(function (failure) {
        return failure.kind === 'timeout';
    });
}

function failureMessage(result: PerTestResult): string {
    return inspect(result.outcome, { depth: 4, breakLength: Number.POSITIVE_INFINITY });
}

function diagnosticMessage(errors: readonly RunnerError[], fallback: string): string {
    const message = errors
        .map(function (error) {
            return error.message;
        })
        .join('\n');
    return message.length === 0 ? fallback : message;
}

function supportedCaseOutcome(root: string, result: PerTestResult, errors: readonly RunnerError[]): boolean {
    if ([ 'pass', 'skip' ].includes(result.verdict)) {
        return true;
    }
    if (safeMutationFailure(root, result, errors)) {
        return true;
    }
    return timedOut(result) && result.outcome?.kind === 'fail' &&
        result.outcome.failures.every(function (failure) {
            return failure.kind === 'timeout' || isKillingFailure(failure);
        });
}

function mutantDiagnostic(
    root: string,
    reply: ResultReply,
    data: LifecycleData,
    expectation: Extract<MutationInvocationExpectation, { readonly kind: 'mutant'; }>
): string | null {
    const observation = mutationObservationError(root, reply, expectation);
    if (observation !== null) {
        return observation;
    }
    const infrastructure = infrastructureErrors(root, data.catalog, reply.result.runnerErrors);
    if (infrastructure.length > 0) {
        return diagnosticMessage(infrastructure, 'Mutant execution failed.');
    }
    if (
        data.bailed && reply.result.perTest.every(function confirmedKill(result) {
            return !safeMutationFailure(root, result, reply.result.runnerErrors);
        })
    ) {
        return 'Execution stopped without a confirmed eligible failure.';
    }
    const supported = reply.result.perTest.every(function (result) {
        return supportedCaseOutcome(root, result, reply.result.runnerErrors);
    });
    return supported ? null : 'Mutant execution was inconclusive.';
}

function killedResult(root: string, killed: readonly PerTestResult[], nrOfTests: number): MutantRunResult {
    const first = killed[0];
    if (first === undefined) {
        return { status: MutantRunStatus.Survived, nrOfTests };
    }
    return {
        status: MutantRunStatus.Killed,
        killedBy: killed.map(function (result) {
            return workIdentityKey(canonicalWork(root, result.workId));
        }),
        failureMessage: failureMessage(first),
        nrOfTests
    };
}

function completedMutantResult(
    root: string,
    reply: ResultReply,
    expectation: Extract<MutationInvocationExpectation, { readonly kind: 'mutant'; }>
): MutantRunResult {
    const data = mutationLifecycleDataSchema.parse(reply.data);
    const diagnostic = mutantDiagnostic(root, reply, data, expectation);
    if (diagnostic !== null) {
        return { status: MutantRunStatus.Error, errorMessage: diagnostic };
    }
    if (reply.deadlineExceeded || data.hitLimitExceeded || reply.result.perTest.some(timedOut)) {
        return { status: MutantRunStatus.Timeout, reason: 'Mutant exceeded its deadline, hit limit, or test timeout.' };
    }
    const killed = reply.result.perTest.filter(function (result) {
        return safeMutationFailure(root, result, reply.result.runnerErrors);
    });
    const executed = reply.result.perTest.filter(function (result) {
        return result.verdict !== 'skip';
    });
    return killedResult(root, killed, executed.length);
}

function hitLimitGuard(message: string): boolean {
    return /^Stryker: Hit count limit reached \(\d+\)$/u.test(message);
}

function guardCause(cause: unknown): boolean {
    return cause instanceof Error && hitLimitGuard(cause.message);
}

function trackedHitLimitFailure(reply: Extract<RunExecutionReply, { readonly kind: 'failure'; }>): boolean {
    if (mutationLifecycleDataSchema.safeParse(reply.data).data?.hitLimitExceeded !== true) {
        return false;
    }
    if (reply.failure.kind === 'collection-error') {
        return reply.failure.errors.every(function isLoaderGuard(error) {
            return error.subtype === 'loader' && guardCause(error.cause);
        });
    }
    return hitLimitGuard(reply.failure.message) || guardCause(reply.failure.cause);
}

export function mutantExecutionResult(
    root: string,
    reply: RunExecutionReply,
    expectation: Extract<MutationInvocationExpectation, { readonly kind: 'mutant'; }>
): MutantRunResult {
    if (reply.kind === 'failure') {
        return trackedHitLimitFailure(reply)
            ? { status: MutantRunStatus.Timeout, reason: 'Mutant exceeded its hit limit.' }
            : { status: MutantRunStatus.Error, errorMessage: reply.failure.message };
    }
    if (reply.kind === 'timeout') {
        return { status: MutantRunStatus.Timeout, reason: 'Mutant invocation exceeded its deadline.' };
    }
    return completedMutantResult(root, reply, expectation);
}
