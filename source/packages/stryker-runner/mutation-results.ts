import { inspect } from 'node:util';
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
import { mutationDiagnostics, hasMutationExecutionError } from './mutation-diagnostics.ts';
import { interruptedMutantResult } from './mutation-interrupted-result.ts';

type ResultReply = Extract<RunExecutionReply, { readonly kind: 'result'; }>;

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

type MutationDiagnostics = ReturnType<typeof mutationDiagnostics>;
type CompletedEvidence = {
    readonly data: ReturnType<typeof mutationLifecycleDataSchema.parse> | null;
    readonly observation: string | null;
    readonly diagnostics: MutationDiagnostics;
    readonly classifications: readonly MutationCaseClassification[];
};

function unconfirmedBail(evidence: CompletedEvidence): string | null {
    const stoppedWithoutKill = evidence.data?.bailed === true &&
        evidence.diagnostics.caseFailures.every(function noKill(failure) {
            return failure.kind !== 'killed';
        });
    return stoppedWithoutKill ? 'Execution stopped without a confirmed eligible failure.' : null;
}

function completedMutationError(evidence: CompletedEvidence): string | null {
    const bail = unconfirmedBail(evidence);
    const errors = [ evidence.observation, bail, ...evidence.diagnostics.infrastructureErrors ];
    if (
        errors.every(function noError(error) {
            return error === null;
        }) && !hasMutationExecutionError(evidence.diagnostics)
    ) {
        return null;
    }
    const message = [
        ...errors.filter(function presentError(error) {
            return error !== null;
        }),
        ...evidence.diagnostics.caseFailures.map(function caseDiagnostic(failure) {
            return failure.message;
        })
    ]
        .join('\n');
    return message.length === 0 ? 'Mutant execution failed.' : message;
}

function mutationTimedOut(reply: ResultReply, evidence: CompletedEvidence): boolean {
    return reply.deadlineExceeded || evidence.data?.hitLimitExceeded === true ||
        evidence.diagnostics.caseFailures.some(function timeout(failure) {
            return failure.kind === 'timeout';
        });
}

function completedMutantResult(root: string, reply: ResultReply, evidence: CompletedEvidence): MutantRunResult {
    const errorMessage = completedMutationError(evidence);
    if (errorMessage !== null) {
        return { status: MutantRunStatus.Error, errorMessage };
    }
    if (mutationTimedOut(reply, evidence)) {
        return {
            status: MutantRunStatus.Timeout,
            reason: [
                'Mutant exceeded its deadline, hit limit, or test timeout.',
                ...evidence.diagnostics.caseFailures.map(function caseDiagnostic(failure) {
                    return failure.message;
                })
            ]
                .join('\n')
        };
    }
    return killingResult(root, reply, evidence.classifications);
}

function observedMutantResult(
    root: string,
    reply: RunExecutionReply,
    expectation: Extract<MutationInvocationExpectation, { readonly kind: 'mutant'; }>
): MutantRunResult {
    if (reply.kind !== 'result') {
        return interruptedMutantResult(root, reply, expectation);
    }
    const observations = reply.result.perTest.map(function observeCase(result) {
        return {
            id: workIdentityKey(canonicalWork(root, result.workId)),
            classification: classifyMutationCase(root, result, reply.result.runnerErrors)
        };
    });
    const parsed = mutationLifecycleDataSchema.safeParse(reply.data);
    return completedMutantResult(root, reply, {
        data: parsed.data ?? null,
        observation: parsed.success
            ? mutationObservationError(root, reply, expectation)
            : 'Invalid mutation lifecycle data.',
        diagnostics: mutationDiagnostics(observations, reply.result.runnerErrors),
        classifications: observations.map(function caseClassification(observed) {
            return observed.classification;
        })
    });
}

function invalidMutantResult(reply: RunExecutionReply, cause: unknown): MutantRunResult {
    const options = { depth: 6, maxArrayLength: null, maxStringLength: null, customInspect: false };
    const diagnostics = reply.kind === 'result'
        ? [
            ...reply.result.perTest.map(function deliveredCase(result) {
                const id = workIdentityKey(result.workId);
                return `${id}: ${inspect({ outcome: result.outcome, attempts: result.attempts }, options)}`;
            }),
            ...reply.result.runnerErrors.map(function deliveredError(error) {
                return inspect(error, options);
            })
        ]
        : [ inspect(reply.data, options) ];
    return { status: MutantRunStatus.Error, errorMessage: [ inspect(cause, options), ...diagnostics ].join('\n') };
}

export function mutantExecutionResult(
    root: string,
    reply: RunExecutionReply,
    expectation: Extract<MutationInvocationExpectation, { readonly kind: 'mutant'; }>
): MutantRunResult {
    try {
        return observedMutantResult(root, reply, expectation);
    } catch (error: unknown) {
        return invalidMutantResult(reply, error);
    }
}

export function expiredMutantResult(completed: Readonly<MutantRunResult> | null): MutantRunResult {
    if (completed === null || completed.status === MutantRunStatus.Survived) {
        return { status: MutantRunStatus.Timeout, reason: 'Mutant invocation exceeded its deadline.' };
    }
    if (completed.status === MutantRunStatus.Error || completed.status === MutantRunStatus.Timeout) {
        return completed;
    }
    return {
        status: MutantRunStatus.Timeout,
        reason: `Mutant invocation exceeded its deadline.\n${completed.failureMessage}`
    };
}
