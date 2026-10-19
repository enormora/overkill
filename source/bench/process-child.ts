import { spawn } from 'node:child_process';
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

function pipeChild(input: ProcessLaunch): ProcessChild {
    const exited = Promise.withResolvers<ProcessExit>();
    const closed = Promise.withResolvers<undefined>();
    const child = spawn(input.request.command[0], input.arguments, {
        cwd: input.request.cwd,
        env: input.environment,
        detached: true,
        stdio: [ 'pipe', 'pipe', 'pipe' ]
    });
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
        exited.resolve({ code, signal, time: process.hrtime.bigint() });
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

export async function prepareProcessLauncher(kind: 'pipes' | 'pty'): Promise<(input: ProcessLaunch) => ProcessChild> {
    if (kind === 'pipes') {
        return pipeChild;
    }
    const terminal = await import('node-pty');
    return function terminalChild(input) {
        if (input.request.kind !== 'pty') {
            throw new TypeError('Terminal execution requires PTY options.');
        }
        const exited = Promise.withResolvers<ProcessExit>();
        const closed = Promise.withResolvers<undefined>();
        const child = terminal.spawn(input.request.command[0], Array.from(input.arguments), {
            cwd: input.request.cwd,
            env: input.environment,
            name: input.request.name,
            cols: input.request.columns,
            rows: input.request.rows
        });
        child.onData(function captureTerminal(text) {
            input.output.append('terminal', Buffer.from(text));
        });
        child.onExit(function recordTerminalExit(exit) {
            exited.resolve({
                code: exit.signal === undefined || exit.signal === 0 ? exit.exitCode : null,
                signal: exit.signal === undefined || exit.signal === 0 ? null : String(exit.signal),
                time: process.hrtime.bigint()
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
    };
}

export function signalProcessGroup(pid: number | null, signal: 'SIGKILL' | 'SIGTERM'): void {
    if (pid === null) {
        return;
    }
    try {
        process.kill(-pid, signal);
    } catch (error: unknown) {
        if (!(error instanceof Error) || Reflect.get(error, 'code') !== 'ESRCH') {
            throw error;
        }
    }
}

const processGraceMilliseconds = 500;

async function awaitGracefulProcessExit(child: ProcessChild): Promise<void> {
    try {
        await withinProcessDeadline(child.closed, processGraceMilliseconds, 'Process ignored graceful shutdown.');
    } catch (error: unknown) {
        if (!(error instanceof ProcessDeadlineError)) {
            throw error;
        }
    }
}

export async function disposeProcessChild(child: ProcessChild): Promise<void> {
    signalProcessGroup(child.pid, 'SIGTERM');
    try {
        await awaitGracefulProcessExit(child);
    } finally {
        signalProcessGroup(child.pid, 'SIGKILL');
    }
    await withinProcessDeadline(
        child.closed,
        processGraceMilliseconds,
        'Process output did not close within the shutdown deadline.'
    );
}
