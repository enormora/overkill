import { withRunnerInfrastructure } from '../engine/execution-observation.ts';
import { createStoredValue, type StoredValue } from '../stored-value.ts';
import {
    createInvocationBudget,
    InvocationDeadlineExceededError,
    isInvocationCancellation,
    type InvocationBudget
} from '../invocation-budget.ts';
import type { ExecutionSessionEnvironment } from './execution-session-runtime-types.ts';
import { runExecutionFailure } from './execution-failure.ts';
import { executionTransportSchema, normalizeExecutionSessionOptions } from './execution-session-schema.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import type { RunExecutionSessionOptions } from './run-types.ts';
import type { RunExecutionInvocation, RunExecutionReply, RunExecutionSession } from './execution-session-types.ts';

type InvocationExecution = {
    readonly invocation: RunExecutionInvocation;
    readonly budget: InvocationBudget;
    readonly data: StoredValue<RunExecutionReply['data']>;
    readonly lifecycle: RunExecutionSessionOptions['lifecycle'];
};

async function initializeExecutionEnvironment(
    options: RunExecutionSessionOptions,
    dependencies: RunOrchestratorDependencies
): Promise<ExecutionSessionEnvironment> {
    const { createExecutionSessionEnvironment } = await withRunnerInfrastructure(
        async function loadExecutionEnvironment() {
            return await import('./execution-session-environment.ts');
        }
    );
    return createExecutionSessionEnvironment(options, dependencies);
}

function deadlineCancelledReply(
    reply: RunExecutionReply,
    signal: AbortSignal
): reply is Extract<RunExecutionReply, { readonly kind: 'failure'; }> {
    return reply.kind === 'failure' && signal.reason instanceof InvocationDeadlineExceededError &&
        isInvocationCancellation(reply.failure.cause, signal);
}

async function completeInvocation(
    environment: Promise<ExecutionSessionEnvironment>,
    execution: InvocationExecution
): Promise<RunExecutionReply> {
    const { invocation, budget, lifecycle, data } = execution;
    const { signal } = budget;
    signal.throwIfAborted();
    const transport = executionTransportSchema.parse({ lifecycle, data: structuredClone(invocation.data) });
    const initialized = await environment;
    signal.throwIfAborted();
    const reply = await initialized.execute({
        transport,
        timeoutMilliseconds: budget.remainingMilliseconds(),
        signal,
        async checkpoint(snapshot) {
            data.write(structuredClone(snapshot));
        }
    });
    if (deadlineCancelledReply(reply, signal)) {
        return { kind: 'timeout', artifacts: reply.artifacts, data: reply.data };
    }
    return reply.kind === 'result' ? { ...reply, deadlineExceeded: reply.deadlineExceeded || budget.expired() } : reply;
}

async function executeInvocation(
    environment: Promise<ExecutionSessionEnvironment>,
    invocation: RunExecutionInvocation,
    budget: InvocationBudget,
    lifecycle: RunExecutionSessionOptions['lifecycle']
): Promise<RunExecutionReply> {
    const data = createStoredValue<RunExecutionReply['data']>(null);
    try {
        return await completeInvocation(environment, { invocation, budget, lifecycle, data });
    } catch (error: unknown) {
        const timedOut = budget.signal.reason instanceof InvocationDeadlineExceededError &&
            isInvocationCancellation(error, budget.signal);
        return timedOut
            ? { kind: 'timeout', artifacts: [], data: data.read() }
            : { kind: 'failure', artifacts: [], failure: runExecutionFailure(error), data: data.read() };
    } finally {
        budget.dispose();
    }
}

function assertSessionAdmission(disposed: AbortSignal, active: Promise<RunExecutionReply> | null): void {
    if (disposed.aborted) {
        throw new Error('Execution session has been disposed.');
    }
    if (active !== null) {
        throw new Error('An execution invocation is already running.');
    }
}

function executionLifetime(options: RunExecutionSessionOptions): RunExecutionSession['environmentLifetime'] {
    const fresh = options.environment === 'fresh-invocation' ||
        options.command.policy.profile.execution.processModel === 'supervised-process';
    return fresh ? 'fresh' : 'reused';
}

export function createExecutionSession(
    supplied: RunExecutionSessionOptions,
    dependencies: RunOrchestratorDependencies
): RunExecutionSession {
    const options = normalizeExecutionSessionOptions(supplied, dependencies.createSeed);
    const environment = createStoredValue<Promise<ExecutionSessionEnvironment> | null>(null);
    const disposed = new AbortController();
    const active = createStoredValue<Promise<RunExecutionReply> | null>(null);
    async function initializedEnvironment(): Promise<ExecutionSessionEnvironment> {
        const initialized = environment.read() ?? initializeExecutionEnvironment(options, dependencies);
        environment.write(initialized);
        return initialized;
    }
    return {
        environmentLifetime: executionLifetime(options),
        async run(invocation) {
            assertSessionAdmission(disposed.signal, active.read());
            if (!Number.isFinite(invocation.timeoutMilliseconds) || invocation.timeoutMilliseconds <= 0) {
                return { kind: 'timeout', artifacts: [], data: null };
            }
            const signal = AbortSignal.any([
                disposed.signal,
                ...invocation.signal === null ? [] : [ invocation.signal ]
            ]);
            const budget = createInvocationBudget(invocation.timeoutMilliseconds, signal, dependencies.wallClock);
            const running = executeInvocation(initializedEnvironment(), invocation, budget, options.lifecycle);
            active.write(running);
            try {
                return await running;
            } finally {
                active.write(null);
            }
        },
        async dispose() {
            disposed.abort();
            await active.read();
        }
    };
}
