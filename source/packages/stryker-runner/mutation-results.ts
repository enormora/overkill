import {
    MutantRunStatus,
    type MutantRunResult
} from '@stryker-mutator/api/test-runner';
import {
    workIdentityKey,
    type RunExecutionReply
} from '../run/run.entry-point.ts';
import { canonicalWork, mutationLifecycleDataSchema } from './mutation-catalog.ts';
import { mutationObservationError, type MutationInvocationExpectation } from './mutation-observation.ts';
import { classifyMutationCase, type MutationCaseClassification } from './mutation-case-classification.ts';

type ResultReply = Extract<RunExecutionReply, { readonly kind: 'result'; }>;
type LifecycleData = Readonly<ReturnType<typeof mutationLifecycleDataSchema.parse>>;

function mutantDiagnostic(
    reply: ResultReply,
    data: LifecycleData,
    classifications: readonly MutationCaseClassification[]
): string | null {
    const attributed = new Set(classifications.flatMap(function attributedErrors(classification) {
        return classification.kind === 'killed' || classification.kind === 'timeout' ? classification.runnerErrors : [];
    }));
    const infrastructure = reply.result.runnerErrors.filter(function unclaimedError(error) {
        return !attributed.has(error);
    });
    const diagnostics = [
        ...infrastructure.map(function runnerDiagnostic(error) {
            return error.message;
        }),
        ...classifications.flatMap(function invalidCase(classification) {
            return classification.kind === 'error' ? [ classification.message ] : [];
        })
    ];
    if (diagnostics.length > 0) {
        const message = diagnostics.join('\n');
        return message.length === 0 ? 'Mutant execution failed.' : message;
    }
    const killed = classifications.some(function confirmedKill(classification) {
        return classification.kind === 'killed';
    });
    return data.bailed && !killed ? 'Execution stopped without a confirmed eligible failure.' : null;
}

function killingResult(
    root: string,
    reply: ResultReply,
    classifications: readonly MutationCaseClassification[]
): MutantRunResult {
    const killedBy = reply.result.perTest.flatMap(function killingIdentity(result, index) {
        return classifications[index]?.kind === 'killed' ? [ workIdentityKey(canonicalWork(root, result.workId)) ] : [];
    });
    const nrOfTests = reply
        .result
        .perTest
        .filter(function executedCase(result) {
            return result.verdict !== 'skip';
        })
        .length;
    if (killedBy.length === 0) {
        return { status: MutantRunStatus.Survived, nrOfTests };
    }
    return {
        status: MutantRunStatus.Killed,
        killedBy,
        failureMessage: classifications
            .flatMap(function killingDiagnostic(classification) {
                return classification.kind === 'killed' ? [ classification.message ] : [];
            })
            .join('\n'),
        nrOfTests
    };
}

function completedMutantResult(
    root: string,
    reply: ResultReply
): MutantRunResult {
    const data = mutationLifecycleDataSchema.parse(reply.data);
    const classifications = reply.result.perTest.map(function classifyCase(result) {
        return classifyMutationCase(root, result, reply.result.runnerErrors);
    });
    const diagnostic = mutantDiagnostic(reply, data, classifications);
    if (diagnostic !== null) {
        return { status: MutantRunStatus.Error, errorMessage: diagnostic };
    }
    if (
        reply.deadlineExceeded || data.hitLimitExceeded || classifications.some(function timedOut(classification) {
            return classification.kind === 'timeout';
        })
    ) {
        return { status: MutantRunStatus.Timeout, reason: 'Mutant exceeded its deadline, hit limit, or test timeout.' };
    }
    return killingResult(root, reply, classifications);
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
    const observation = mutationObservationError(root, reply, expectation);
    return observation === null
        ? completedMutantResult(root, reply)
        : { status: MutantRunStatus.Error, errorMessage: observation };
}
