import { inspect } from 'node:util';
import { MutantRunStatus, type MutantRunResult } from '@stryker-mutator/api/test-runner';
import type { RunExecutionReply } from '../run/run.entry-point.ts';
import { mutationLifecycleDataSchema } from './mutation-catalog.ts';
import { mutationDiagnostics, hasMutationExecutionError } from './mutation-diagnostics.ts';
import { mutationSnapshotError, type MutationInvocationExpectation } from './mutation-observation.ts';

type InterruptedReply = Exclude<RunExecutionReply, { readonly kind: 'result'; }>;
type LifecycleData = Readonly<ReturnType<typeof mutationLifecycleDataSchema.parse>>;

function hitLimitGuard(message: string): boolean {
    return /^Stryker: Hit count limit reached \(\d+\)$/u.test(message);
}

function guardCause(cause: unknown): boolean {
    return cause instanceof Error && cause.name === 'Error' && hitLimitGuard(cause.message) &&
        cause.cause === undefined;
}

function guardOnlyCause(cause: unknown): boolean {
    return cause === null || cause === undefined || guardCause(cause);
}

function trackedHitLimitFailure(reply: Extract<InterruptedReply, { readonly kind: 'failure'; }>): boolean {
    if (reply.failure.kind === 'collection-error') {
        return reply.failure.errors.every(function isLoaderGuard(error) {
            return error.subtype === 'loader' && guardCause(error.cause);
        });
    }
    return reply.failure.kind === 'error' && reply.failure.name === 'Error' &&
        hitLimitGuard(reply.failure.message) && guardOnlyCause(reply.failure.cause);
}

function interruptedBailError(
    data: LifecycleData,
    expectation: Extract<MutationInvocationExpectation, { readonly kind: 'mutant'; }>
): string | null {
    if (!data.bailed) {
        return null;
    }
    if (expectation.disableBail) {
        return 'Execution stopped despite disabled bail.';
    }
    const confirmedKill = data.caseFailures.some(function killed(failure) {
        return failure.kind === 'killed';
    });
    return confirmedKill ? null : 'Execution stopped without a confirmed eligible failure.';
}

function snapshotError(
    root: string,
    data: LifecycleData,
    expectation: Extract<MutationInvocationExpectation, { readonly kind: 'mutant'; }>
): string | null {
    const uncollected = data.catalog.length === 0 && data.selected.length === 0 && data.completed.length === 0 &&
        data.caseFailures.length === 0;
    const observation = uncollected ? null : mutationSnapshotError(root, data, expectation);
    return observation ?? interruptedBailError(data, expectation);
}

function interruptedDiagnostic(reply: InterruptedReply): string {
    if (reply.kind === 'timeout') {
        return 'Mutant invocation exceeded its deadline.';
    }
    return reply.failure.name === 'AggregateError'
        ? `${reply.failure.message}\n${inspect(reply.failure.cause, { depth: 6, maxArrayLength: null })}`
        : reply.failure.message;
}

function interruptedTimeout(reply: InterruptedReply, data: LifecycleData | null): boolean {
    return reply.kind === 'timeout' || data?.hitLimitExceeded === true && trackedHitLimitFailure(reply);
}

function interruptedReason(reply: InterruptedReply, data: LifecycleData | null): string {
    return reply.kind === 'failure' && interruptedTimeout(reply, data)
        ? 'Mutant exceeded its hit limit.'
        : interruptedDiagnostic(reply);
}

function interruptedSnapshotResult(
    root: string,
    reply: InterruptedReply,
    data: LifecycleData | null,
    expectation: Extract<MutationInvocationExpectation, { readonly kind: 'mutant'; }>
): MutantRunResult {
    const invalid = data === null ? null : snapshotError(root, data, expectation);
    const diagnostics = data ?? mutationDiagnostics([], []);
    const message = [
        invalid,
        interruptedReason(reply, data),
        ...diagnostics.infrastructureErrors,
        ...diagnostics.caseFailures.map(function caseMessage(failure) {
            return failure.message;
        })
    ]
        .filter(function presentMessage(part) {
            return part !== null;
        })
        .join('\n');
    if (invalid !== null || hasMutationExecutionError(diagnostics)) {
        return { status: MutantRunStatus.Error, errorMessage: message };
    }
    if (interruptedTimeout(reply, data)) {
        return { status: MutantRunStatus.Timeout, reason: message };
    }
    return { status: MutantRunStatus.Error, errorMessage: message };
}

export function interruptedMutantResult(
    root: string,
    reply: InterruptedReply,
    expectation: Extract<MutationInvocationExpectation, { readonly kind: 'mutant'; }>
): MutantRunResult {
    if (reply.data === null) {
        return interruptedSnapshotResult(root, reply, null, expectation);
    }
    const parsed = mutationLifecycleDataSchema.safeParse(reply.data);
    if (!parsed.success) {
        return {
            status: MutantRunStatus.Error,
            errorMessage: `${interruptedDiagnostic(reply)}\nInvalid mutation lifecycle data: ${parsed.error.message}`
        };
    }
    return interruptedSnapshotResult(root, reply, parsed.data, expectation);
}
