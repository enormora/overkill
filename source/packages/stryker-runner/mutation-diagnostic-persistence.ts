import { randomUUID } from 'node:crypto';
import {
    DryRunStatus,
    MutantRunStatus,
    TestStatus,
    type DryRunResult,
    type MutantRunResult
} from '@stryker-mutator/api/test-runner';
import { serializeValue } from '../engine/engine.entry-point.ts';
import type { InvocationBudget, RunExecutionReply } from '../run/run.entry-point.ts';
import { mutationDiagnosticEvidence } from './mutation-diagnostic-evidence.ts';
import { mutationLifecycleDataSchema } from './mutation-catalog.ts';
import {
    writeMutationDiagnostics,
    type MutationDiagnosticContext,
    type MutationDiagnosticExecution
} from './mutation-diagnostic-storage.ts';

type MutationResult = DryRunResult | MutantRunResult;
type MutationInvocationDiagnostics = {
    readonly record: (reply: RunExecutionReply) => void;
    readonly complete: (result: MutationResult) => Promise<void>;
};
type DiagnosticInvocation = {
    readonly context: MutationDiagnosticContext;
    readonly execution: MutationDiagnosticExecution;
    readonly budget: InvocationBudget;
    readonly invocation: string;
    readonly reply: () => RunExecutionReply | null;
    readonly record: (reply: RunExecutionReply) => void;
    readonly storageFailed: () => boolean;
    readonly failStorage: () => void;
    readonly admitCompletion: (result: MutationResult, expired: boolean) => boolean;
};

function failedInvocation(result: MutationResult): boolean {
    return result.status === DryRunStatus.Complete
        ? result.tests.some(function failedTest(test) {
            return test.status === TestStatus.Failed;
        })
        : result.status !== MutantRunStatus.Survived;
}
function resultFailure(result: MutationResult): unknown {
    if (result.status === DryRunStatus.Error) {
        return result.errorMessage;
    }
    return result.status === DryRunStatus.Timeout ? result.reason ?? 'Mutation invocation timed out.' : null;
}
function deadlineFailure(budget: InvocationBudget): unknown {
    return budget.expired() ? budget.signal.reason : null;
}
function retainedInvocation(state: DiagnosticInvocation, failed: boolean): boolean {
    return state.context.mode === 'all' || state.context.mode === 'failures' && (failed || state.budget.expired());
}
function executionFailure(reply: RunExecutionReply | null): unknown {
    return reply?.kind === 'failure' ? reply.failure : null;
}
function readPriorFailureDiagnostic(reply: RunExecutionReply): string {
    const parsed = mutationLifecycleDataSchema.safeParse(reply.data);
    if (!parsed.success) {
        return '';
    }
    return [
        ...parsed.data.infrastructureErrors,
        ...parsed.data.caseFailures.map(function failureMessage(failure) {
            return failure.message;
        })
    ]
        .join('\n');
}

function priorFailureDiagnostic(reply: RunExecutionReply | null): string {
    if (reply === null) {
        return '';
    }
    try {
        return readPriorFailureDiagnostic(reply);
    } catch (error: unknown) {
        return String(error);
    }
}

function persistenceFailureDiagnostic(state: DiagnosticInvocation, failure: unknown): string {
    const prior = priorFailureDiagnostic(state.reply());
    if (failure === null) {
        return prior;
    }
    const message = typeof failure === 'string' ? failure : JSON.stringify(serializeValue(failure));
    return `${message}\n${prior}`;
}

async function writeInvocationDiagnostics(state: DiagnosticInvocation, failure: unknown): Promise<void> {
    const { context } = state;
    const diagnostics = mutationDiagnosticEvidence(context.root, state.reply());
    const error = failure ?? executionFailure(state.reply());
    const empty = diagnostics.artifacts.length + diagnostics.perTest.length + diagnostics.runnerErrors.length === 0;
    if (error === null && empty) {
        return;
    }
    await writeMutationDiagnostics(context, {
        version: 1,
        campaign: context.campaign,
        invocation: state.invocation,
        seed: context.seed,
        profile: context.profile,
        execution: state.execution,
        diagnostics,
        failure: error === null ? null : serializeValue(error)
    });
}
async function persistInvocation(state: DiagnosticInvocation, failed: boolean, failure: unknown): Promise<void> {
    if (!retainedInvocation(state, failed)) {
        return;
    }
    try {
        await writeInvocationDiagnostics(state, failure);
    } catch (error: unknown) {
        const storageError = new Error(
            `Mutation diagnostic persistence failed: ${String(error)}\n${persistenceFailureDiagnostic(state, failure)}`,
            { cause: error }
        );
        state.failStorage();
        throw storageError;
    }
}
async function completeInvocation(state: DiagnosticInvocation, result: MutationResult): Promise<void> {
    const expired = state.budget.expired();
    if (!state.admitCompletion(result, expired)) {
        return;
    }
    const failure: unknown = resultFailure(result) ?? deadlineFailure(state.budget);
    await persistInvocation(state, failedInvocation(result), failure);
}
async function failedMutationInvocation(state: DiagnosticInvocation, error: unknown): Promise<never> {
    if (!state.storageFailed()) {
        try {
            await persistInvocation(state, true, error);
        } catch (persistenceError: unknown) {
            throw new AggregateError(
                [ error, persistenceError ],
                `Mutation execution and persistence failed: ${String(error)}\n${String(persistenceError)}`,
                { cause: persistenceError }
            );
        }
    }
    throw error;
}
async function runDiagnosticInvocation<Value extends MutationResult>(
    state: DiagnosticInvocation,
    run: (diagnostics: MutationInvocationDiagnostics) => Promise<Value>
): Promise<Value> {
    const result = await run({
        record: state.record,
        async complete(completed) {
            await completeInvocation(state, completed);
        }
    });
    await completeInvocation(state, result);
    return result;
}
export async function withMutationDiagnosticPersistence<Value extends MutationResult>(
    context: MutationDiagnosticContext,
    execution: MutationDiagnosticExecution,
    budget: InvocationBudget,
    run: (diagnostics: MutationInvocationDiagnostics) => Promise<Value>
): Promise<Value> {
    let reply: RunExecutionReply | null = null;
    let storageFailed = false;
    let completion: { readonly result: MutationResult; readonly expired: boolean; } | null = null;
    const state: DiagnosticInvocation = {
        context,
        execution,
        budget,
        invocation: randomUUID(),
        reply() {
            return reply;
        },
        record(delivered) {
            reply = delivered;
        },
        storageFailed() {
            return storageFailed;
        },
        failStorage() {
            storageFailed = true;
        },
        admitCompletion(result, expired) {
            if (completion?.result === result && completion.expired === expired) {
                return false;
            }
            completion = { result, expired };
            return true;
        }
    };
    try {
        return await runDiagnosticInvocation(state, run);
    } catch (error: unknown) {
        return await failedMutationInvocation(state, error);
    }
}
