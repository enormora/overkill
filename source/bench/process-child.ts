import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { IPty } from 'node-pty';
import { ProcessDeadlineError, withinProcessDeadline } from './process-deadline.ts';
import type { ProcessCommand } from './process-command.ts';
import type { ProcessOutput } from './process-output.ts';

export type ProcessExit = { readonly code: number | null; readonly signal: string | null; readonly time: bigint; };
export type ProcessChild = {
    readonly pid: number | null;
    readonly exit: Promise<ProcessExit>;
    readonly closed: Promise<void>;
    readonly write: (text: string) => Promise<void>;
    readonly closeInput: () => void;
    readonly resize: (columns: number, rows: number) => void;
};
export type ProcessLaunch = {
    readonly request: ProcessCommand;
    readonly arguments: readonly string[];
    readonly environment: Readonly<Record<string, string | undefined>>;
    readonly output: ProcessOutput;
};

export type PipeLaunchRuntime = {
    readonly spawn: (
        input: ProcessLaunch
    ) => Pick<ChildProcessWithoutNullStreams, 'pid' | 'stderr' | 'stdin' | 'stdout'> & {
        readonly on: {
            (event: 'error', receive: (error: Error) => void): unknown;
            (event: 'exit', receive: (code: number | null, signal: string | null) => void): unknown;
            (event: 'close', receive: () => void): unknown;
        };
    };
    readonly now: () => bigint;
};
export type TerminalLaunchRuntime = {
    readonly spawn: (input: ProcessLaunch) => Pick<IPty, 'onData' | 'onExit' | 'pid' | 'resize' | 'write'>;
    readonly now: () => bigint;
};
export function launchPipeProcess(input: ProcessLaunch, runtime: PipeLaunchRuntime): ProcessChild {
    const child = runtime.spawn(input);
    const exited = Promise.withResolvers<ProcessExit>();
    const closed = Promise.withResolvers<undefined>();
    child.stdout.on('data', function captureStdout(chunk: Buffer) {
        input.output.append('stdout', chunk);
    });
    child.stderr.on('data', function captureStderr(chunk: Buffer) {
        input.output.append('stderr', chunk);
    });
    child.stdin.on('error', function rejectInput(error: Error) {
        exited.reject(error);
    });
    child.on('error', exited.reject);
    child.on('exit', function recordExit(code, signal) {
        exited.resolve({ code, signal, time: runtime.now() });
    });
    child.on('close', function processOutputClosed() {
        closed.resolve(undefined);
    });
    return {
        pid: child.pid ?? null,
        exit: exited.promise,
        closed: closed.promise,
        async write(text) {
            await new Promise<void>(function writeInput(resolve, reject) {
                child.stdin.write(text, function inputWritten(error) {
                    if (error === null || error === undefined) {
                        resolve();
                    } else {
                        reject(error);
                    }
                });
            });
        },
        closeInput() {
            child.stdin.end();
        },
        resize() {
            throw new TypeError('Pipe commands cannot resize a terminal.');
        }
    };
}

export function launchTerminalProcess(input: ProcessLaunch, runtime: TerminalLaunchRuntime): ProcessChild {
    if (input.request.kind !== 'pty') {
        throw new TypeError('Terminal execution requires PTY options.');
    }
    const child = runtime.spawn(input);
    const exited = Promise.withResolvers<ProcessExit>();
    const closed = Promise.withResolvers<undefined>();
    child.onData(function captureTerminal(text) {
        input.output.append('terminal', Buffer.from(text));
    });
    child.onExit(function recordTerminalExit(exit) {
        exited.resolve({
            code: exit.signal === undefined || exit.signal === 0 ? exit.exitCode : null,
            signal: exit.signal === undefined || exit.signal === 0 ? null : String(exit.signal),
            time: runtime.now()
        });
        closed.resolve(undefined);
    });
    return {
        pid: child.pid,
        exit: exited.promise,
        closed: closed.promise,
        async write(text) {
            child.write(text);
        },
        closeInput() {
            throw new TypeError('PTY commands cannot close only their input.');
        },
        resize(columns, rows) {
            child.resize(columns, rows);
        }
    };
}
export async function prepareProcessLauncher(kind: 'pipes' | 'pty'): Promise<(input: ProcessLaunch) => ProcessChild> {
    if (kind === 'pipes') {
        return function pipeChild(input) {
            return launchPipeProcess(input, {
                now: process.hrtime.bigint,
                spawn(request) {
                    return spawn(request.request.command[0], request.arguments, {
                        cwd: request.request.cwd,
                        env: request.environment,
                        detached: true,
                        stdio: [ 'pipe', 'pipe', 'pipe' ]
                    });
                }
            });
        };
    }
    const terminal = await import('node-pty');
    return function terminalChild(input) {
        return launchTerminalProcess(input, {
            now: process.hrtime.bigint,
            spawn(request) {
                if (request.request.kind !== 'pty') {
                    throw new TypeError('Terminal execution requires PTY options.');
                }
                return terminal.spawn(request.request.command[0], Array.from(request.arguments), {
                    cwd: request.request.cwd,
                    env: request.environment,
                    name: request.request.name,
                    cols: request.request.columns,
                    rows: request.request.rows
                });
            }
        });
    };
}

type ProcessSignal = 'SIGKILL' | 'SIGTERM';
export function sendProcessGroupSignal(
    pid: number | null,
    signal: ProcessSignal,
    send: (pid: number, signal: ProcessSignal) => unknown
): void {
    if (pid === null) {
        return;
    }
    try {
        send(-pid, signal);
    } catch (error: unknown) {
        if (!(error instanceof Error) || Reflect.get(error, 'code') !== 'ESRCH') {
            throw error;
        }
    }
}

export function signalProcessGroup(pid: number | null, signal: ProcessSignal): void {
    sendProcessGroupSignal(pid, signal, process.kill);
}
export type ProcessShutdownRuntime = {
    readonly signal: (pid: number | null, signal: ProcessSignal) => void;
    readonly deadline: typeof withinProcessDeadline;
};
const processGraceMilliseconds = 500;

async function awaitGracefulProcessExit(child: ProcessChild, runtime: ProcessShutdownRuntime): Promise<void> {
    try {
        await runtime.deadline(child.closed, processGraceMilliseconds, 'Process ignored graceful shutdown.');
    } catch (error: unknown) {
        if (!(error instanceof ProcessDeadlineError)) {
            throw error;
        }
    }
}

export async function stopProcessChild(child: ProcessChild, runtime: ProcessShutdownRuntime): Promise<void> {
    runtime.signal(child.pid, 'SIGTERM');
    try {
        await awaitGracefulProcessExit(child, runtime);
    } finally {
        runtime.signal(child.pid, 'SIGKILL');
    }
    await runtime.deadline(
        child.closed,
        processGraceMilliseconds,
        'Process output did not close within the shutdown deadline.'
    );
}

export async function disposeProcessChild(child: ProcessChild): Promise<void> {
    await stopProcessChild(child, { signal: signalProcessGroup, deadline: withinProcessDeadline });
}
