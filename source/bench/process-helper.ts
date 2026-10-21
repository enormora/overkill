import { fork, type ChildProcess } from 'node:child_process';
import { clearTimeout as clearTimer, setTimeout as startTimer } from 'node:timers';
import { createStoredValue, type StoredValue } from '../stored-value.ts';
import { processHelperEntryPointUrl } from '../packages/bench/process-helper.entry-point.ts';
import {
    processHelperReplySchema,
    type ProcessExecution,
    type ProcessHelperReply,
    type ProcessHelperRequest
} from './process-protocol.ts';
import type { ProcessCommand } from './process-command.ts';
import type { ProcessInstrumentation } from './process-measurement.ts';
import { signalProcessGroup } from './process-child.ts';
import { withinProcessDeadline } from './process-deadline.ts';
import { timelineContext } from './timeline-context.ts';

type PendingProcess = Readonly<PromiseWithResolvers<ProcessExecution>> & { readonly id: number; };
type HelperConnection = {
    readonly child: ChildProcess;
    readonly ready: Readonly<PromiseWithResolvers<undefined>>;
    readonly closed: Readonly<PromiseWithResolvers<undefined>>;
    readonly instrumentation: ProcessInstrumentation;
    readonly maximumBytes: number;
    readonly startup: StoredValue<ReturnType<typeof startTimer> | null>;
    readonly pending: StoredValue<PendingProcess | null>;
    readonly group: StoredValue<number | null>;
    readonly sequence: StoredValue<number>;
    readonly failure: StoredValue<Error | null>;
    readonly diagnostics: StoredValue<string>;
};
export type ProcessHelper = {
    readonly run: (request: ProcessCommand, signal: AbortSignal) => Promise<ProcessExecution>;
    readonly cancel: () => void;
    readonly close: () => Promise<void>;
};
const helperStartupMilliseconds = 5000;
const helperShutdownMilliseconds = 1000;
const maximumDiagnosticCharacters = 8192;

function failHelper(connection: HelperConnection, error: Error): void {
    connection.failure.write(error);
    connection.ready.reject(error);
    connection.pending.read()?.reject(error);
    connection.pending.write(null);
}

function sendHelperRequest(connection: HelperConnection, message: ProcessHelperRequest): void {
    if (!connection.child.connected) {
        failHelper(connection, new Error('Process helper is disconnected.'));
        return;
    }
    connection.child.send(message, function sent(error) {
        if (error !== null) {
            failHelper(connection, error);
        }
    });
}

function clearStartup(connection: HelperConnection): void {
    const timer = connection.startup.read();
    if (timer !== null) {
        clearTimer(timer);
    }
}

function finishHelperInvocation(
    connection: HelperConnection,
    pending: PendingProcess,
    execution: ProcessExecution
): void {
    connection.group.write(null);
    connection.pending.write(null);
    pending.resolve(execution);
}

function recordProcessCheckpoint(reply: Extract<ProcessHelperReply, { readonly kind: 'checkpoint'; }>): void {
    const recording = timelineContext.getStore();
    if (recording === undefined) {
        return;
    }
    const attribution = recording.attribution();
    recording.append({
        ...attribution,
        name: reply.name,
        source: 'process',
        clockDomain: `process:${attribution.phase}:${attribution.sample}`,
        startMicroseconds: reply.startMicroseconds,
        durationMicroseconds: reply.durationMicroseconds,
        outcome: reply.outcome
    });
}

type InvocationReply = Exclude<ProcessHelperReply, { readonly kind: 'checkpoint' | 'ready'; }>;
function completeInvocationReply(connection: HelperConnection, reply: InvocationReply): void {
    const pending = connection.pending.read();
    if (pending?.id !== reply.id) {
        throw new Error('Process helper replied to an unknown invocation.');
    }
    if (reply.kind === 'started') {
        connection.group.write(reply.pid);
    } else {
        finishHelperInvocation(connection, pending, reply.execution);
    }
}
function completeHelperReply(connection: HelperConnection, reply: ProcessHelperReply): void {
    if (reply.kind === 'ready') {
        clearStartup(connection);
        connection.ready.resolve(undefined);
    } else if (reply.kind === 'checkpoint') {
        if (connection.pending.read()?.id === reply.id) {
            recordProcessCheckpoint(reply);
        }
    } else {
        completeInvocationReply(connection, reply);
    }
}

function receiveHelperReply(connection: HelperConnection, value: unknown): void {
    try {
        completeHelperReply(connection, processHelperReplySchema.parse(value));
    } catch (error: unknown) {
        failHelper(connection, new Error('Invalid process helper reply.', { cause: error }));
        connection.child.kill('SIGKILL');
    }
}

function disconnectedHelper(connection: HelperConnection, code: number | null, signal: string | null): void {
    clearStartup(connection);
    try {
        signalProcessGroup(connection.group.read(), 'SIGKILL');
    } catch (error: unknown) {
        failHelper(connection, new Error('Could not terminate the helper target group.', { cause: error }));
    }
    failHelper(
        connection,
        new Error(`Process helper closed: ${String(code)}, ${String(signal)}. ${connection.diagnostics.read()}`)
    );
    connection.closed.resolve(undefined);
}

function observeHelper(connection: HelperConnection): void {
    connection.child.stderr?.on('data', function diagnostic(chunk: Buffer) {
        connection.diagnostics.write(
            (connection.diagnostics.read() + chunk.toString()).slice(-maximumDiagnosticCharacters)
        );
    });
    connection.child.on('error', function (error: Error) {
        failHelper(connection, error);
    });
    connection.child.on('message', function (value) {
        receiveHelperReply(connection, value);
    });
    connection.child.on('close', function (code, signal) {
        disconnectedHelper(connection, code, signal);
    });
}

function cancelHelperInvocation(connection: HelperConnection): void {
    if (connection.pending.read() !== null) {
        sendHelperRequest(connection, { kind: 'cancel' });
    }
}

async function helperRequest(
    connection: HelperConnection,
    request: ProcessCommand,
    signal: AbortSignal
): Promise<ProcessExecution> {
    const completed = { ...Promise.withResolvers<ProcessExecution>(), id: connection.sequence.read() };
    const abort = function (): void {
        cancelHelperInvocation(connection);
    };
    connection.sequence.write(completed.id + 1);
    connection.pending.write(completed);
    signal.addEventListener('abort', abort, { once: true });
    sendHelperRequest(connection, {
        kind: 'run',
        timeline: timelineContext.getStore() !== undefined,
        id: completed.id,
        request,
        instrumentation: connection.instrumentation,
        maximumBytes: connection.maximumBytes
    });
    try {
        return await completed.promise;
    } finally {
        signal.removeEventListener('abort', abort);
    }
}

async function runHelperCommand(
    connection: HelperConnection,
    request: ProcessCommand,
    signal: AbortSignal
): Promise<ProcessExecution> {
    await connection.ready.promise;
    signal.throwIfAborted();
    const failure = connection.failure.read();
    if (failure !== null) {
        throw failure;
    }
    if (connection.pending.read() !== null) {
        throw new Error('Process helper already owns an invocation.');
    }
    return await helperRequest(connection, request, signal);
}

async function closeHelper(connection: HelperConnection): Promise<void> {
    if (connection.child.connected) {
        sendHelperRequest(connection, { kind: 'close' });
    }
    try {
        await withinProcessDeadline(
            connection.closed.promise,
            helperShutdownMilliseconds,
            'Process helper shutdown exceeded 1000 milliseconds.'
        );
    } catch (error: unknown) {
        signalProcessGroup(connection.group.read(), 'SIGKILL');
        connection.child.kill('SIGKILL');
        await connection.closed.promise;
        throw error;
    }
}

function helperConnection(instrumentation: ProcessInstrumentation, maximumBytes: number): HelperConnection {
    return {
        child: fork(processHelperEntryPointUrl, [], {
            detached: true,
            execArgv: [],
            stdio: [ 'ignore', 'ignore', 'pipe', 'ipc' ]
        }),
        ready: Promise.withResolvers<undefined>(),
        closed: Promise.withResolvers<undefined>(),
        instrumentation,
        maximumBytes,
        startup: createStoredValue<ReturnType<typeof startTimer> | null>(null),
        pending: createStoredValue<PendingProcess | null>(null),
        group: createStoredValue<number | null>(null),
        sequence: createStoredValue(0),
        failure: createStoredValue<Error | null>(null),
        diagnostics: createStoredValue('')
    };
}

export function createProcessHelper(instrumentation: ProcessInstrumentation, maximumBytes: number): ProcessHelper {
    const connection = helperConnection(instrumentation, maximumBytes);
    connection.startup.write(startTimer(function startupExpired() {
        failHelper(connection, new Error('Process helper did not become ready within 5000 milliseconds.'));
        connection.child.kill('SIGKILL');
    }, helperStartupMilliseconds));
    observeHelper(connection);
    return {
        async run(request, signal) {
            return await runHelperCommand(connection, request, signal);
        },
        cancel() {
            cancelHelperInvocation(connection);
        },
        async close() {
            await closeHelper(connection);
        }
    };
}
