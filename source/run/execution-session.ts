import { setTimeout as scheduleDeadline, clearTimeout as cancelDeadline } from 'node:timers';
import { createStoredValue } from '../stored-value.ts';
import type { ExecutionSessionEnvironment } from './execution-session-runtime-types.ts';
import { runExecutionFailure } from './execution-failure.ts';
import { executionTransportSchema, normalizeExecutionSessionOptions } from './execution-session-schema.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import type { RunExecutionSessionOptions } from './run-types.ts';
import type { RunExecutionInvocation, RunExecutionReply, RunExecutionSession } from './execution-session-types.ts';

type InvocationExecution = {
    readonly invocation: RunExecutionInvocation;
    readonly signal: AbortSignal;
    readonly expired: () => boolean;
    readonly lifecycle: RunExecutionSessionOptions['lifecycle'];
};

async function initializeExecutionEnvironment(
    options: RunExecutionSessionOptions,
    dependencies: RunOrchestratorDependencies
): Promise<ExecutionSessionEnvironment> {
    const { createExecutionSessionEnvironment } = await import('./execution-session-environment.ts');
    return createExecutionSessionEnvironment(options, dependencies);
}

function deadlineCancelledReply(reply: RunExecutionReply, signal: AbortSignal, expired: boolean): boolean {
    return reply.kind === 'failure' && expired && signal.reason instanceof Error &&
        reply.failure.message === signal.reason.message;
}

async function completeInvocation(
    environment: Promise<ExecutionSessionEnvironment>,
    execution: InvocationExecution
): Promise<RunExecutionReply> {
    const { invocation, signal, expired, lifecycle } = execution;
    signal.throwIfAborted();
    const transport = executionTransportSchema.parse({ lifecycle, data: structuredClone(invocation.data) });
    const initialized = await environment;
    const reply = await initialized.execute({ transport, timeoutMilliseconds: invocation.timeoutMilliseconds, signal });
    if (deadlineCancelledReply(reply, signal, expired())) {
        return { kind: 'timeout', data: reply.data };
    }
    return reply.kind === 'result' ? { ...reply, deadlineExceeded: reply.deadlineExceeded || expired() } : reply;
}

function cancelledDeadline(error: unknown, signal: AbortSignal, expired: boolean): boolean {
    return expired && (error === signal.reason || error instanceof Error && error.cause === signal.reason);
}

async function executeInvocation(
    environment: Promise<ExecutionSessionEnvironment>,
    invocation: RunExecutionInvocation,
    disposed: AbortSignal,
    lifecycle: RunExecutionSessionOptions['lifecycle']
): Promise<RunExecutionReply> {
    const cancellation = new AbortController();
    const signal = AbortSignal.any([
        disposed,
        cancellation.signal,
        ...invocation.signal === null ? [] : [ invocation.signal ]
    ]);
    const expired = createStoredValue(false);
    const started = performance.now();
    const deadlineExpired = function (): boolean {
        return expired.read() || performance.now() - started >= invocation.timeoutMilliseconds;
    };
    const timer = scheduleDeadline(function cancelExpiredInvocation() {
        expired.write(true);
        cancellation.abort();
    }, invocation.timeoutMilliseconds);
    try {
        return await completeInvocation(environment, { invocation, signal, expired: deadlineExpired, lifecycle });
    } catch (error: unknown) {
        return cancelledDeadline(error, signal, expired.read())
            ? { kind: 'timeout', data: null }
            : { kind: 'failure', failure: runExecutionFailure(error), data: null };
    } finally {
        cancelDeadline(timer);
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
    return {
        environmentLifetime: executionLifetime(options),
        async run(invocation) {
            assertSessionAdmission(disposed.signal, active.read());
            if (!Number.isFinite(invocation.timeoutMilliseconds) || invocation.timeoutMilliseconds <= 0) {
                return { kind: 'timeout', data: null };
            }
            const initialized = environment.read() ?? initializeExecutionEnvironment(options, dependencies);
            environment.write(initialized);
            const running = executeInvocation(initialized, invocation, disposed.signal, options.lifecycle);
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
