import { inspect } from 'node:util';
import {
    MutantRunStatus,
    type MutantRunResult
} from '@stryker-mutator/api/test-runner';
import {
    workIdentityKey,
    type RunExecutionReply
} from '../run/run.entry-point.ts';
import { mutationLifecycleDataSchema } from './mutation-catalog.ts';
import { mutationObservationError, type MutationInvocationExpectation } from './mutation-observation.ts';
import { mutationDiagnostics, hasMutationExecutionError, observeMutationCases } from './mutation-diagnostics.ts';
import {
    interruptedMutantResult,
    interruptedCompletedMutant,
    hitLimitCollectionReply
} from './mutation-interrupted-result.ts';
import { isInterruptedExecution } from './mutation-timeout.ts';

type ResultReply = Extract<RunExecutionReply, { readonly kind: 'result'; }>;

function killingResult(
    reply: ResultReply,
    failures: Readonly<MutationDiagnostics['caseFailures']>
): MutantRunResult {
    const kills = failures.filter(function killed(failure) {
        return failure.kind === 'killed';
    });
    const nrOfTests = reply
        .result
        .perTest
        .filter(function executedCase(result) {
            return result.verdict !== 'skip';
        })
        .length;
    if (kills.length === 0) {
        return { status: MutantRunStatus.Survived, nrOfTests };
    }
    return {
        status: MutantRunStatus.Killed,
        killedBy: kills.map(function killingIdentity(kill) {
            return kill.id;
        }),
        failureMessage: kills
            .map(function killingDiagnostic(kill) {
                return kill.message;
            })
            .join('\n'),
        nrOfTests
    };
}

type MutationDiagnostics = ReturnType<typeof mutationDiagnostics>;
type CompletedEvidence = {
    readonly data: Readonly<ReturnType<typeof mutationLifecycleDataSchema.parse>> | null;
    readonly observation: string | null;
    readonly diagnostics: MutationDiagnostics;
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

function completedMutantResult(reply: ResultReply, evidence: CompletedEvidence): MutantRunResult {
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
    return killingResult(reply, evidence.diagnostics.caseFailures);
}

function completedResult(
    root: string,
    reply: ResultReply,
    expectation: Extract<MutationInvocationExpectation, { readonly kind: 'mutant'; }>,
    data: CompletedEvidence['data']
): MutantRunResult {
    const hitLimitCases = new Set(
        data?.hitLimitExceeded === true
            ? data
                .caseFailures
                .filter(function (failure) {
                    return failure.kind === 'timeout';
                })
                .map(function (failure) {
                    return failure.id;
                })
            : []
    );
    const observations = observeMutationCases(
        root,
        reply.result.perTest,
        reply.result.runnerErrors,
        function hitLimit(id) {
            return hitLimitCases.has(id);
        }
    );
    return completedMutantResult(reply, {
        data,
        observation: data === null
            ? 'Invalid mutation lifecycle data.'
            : mutationObservationError(root, reply, expectation, data),
        diagnostics: mutationDiagnostics(observations, reply.result.runnerErrors)
    });
}

function observedMutantResult(
    root: string,
    reply: RunExecutionReply,
    expectation: Extract<MutationInvocationExpectation, { readonly kind: 'mutant'; }>
): MutantRunResult {
    const parsed = mutationLifecycleDataSchema.safeParse(reply.data);
    if (reply.kind !== 'result') {
        return interruptedMutantResult(root, reply, expectation, parsed);
    }
    const collection = hitLimitCollectionReply(reply, parsed.data ?? null);
    if (collection !== null) {
        return interruptedMutantResult(root, collection, expectation, parsed);
    }
    if (isInterruptedExecution(reply)) {
        return interruptedCompletedMutant(root, reply, expectation, parsed);
    }
    return completedResult(root, reply, expectation, parsed.data ?? null);
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
