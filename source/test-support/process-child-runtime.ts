import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import type { IPty } from 'node-pty';
import { createStoredValue } from '../stored-value.ts';
import { processOutput, type ProcessOutput } from '../bench/process-output.ts';
import {
    launchPipeProcess,
    launchTerminalProcess,
    type ProcessLaunch,
    type ProcessChild
} from '../bench/process-child.ts';

const exitTime = 1234n;
const capturedOutputBytes = 100;
type PipeFixture = {
    readonly child: ProcessChild;
    readonly events: EventEmitter;
    readonly input: readonly string[];
    readonly stdin: Writable;
    readonly stdout: PassThrough;
    readonly stderr: PassThrough;
    readonly output: ProcessOutput;
    readonly receive: (stdout: string, stderr: string) => void;
    readonly finish: (code: number | null, signal: string | null) => void;
};
type TerminalFixture = {
    readonly child: ProcessChild;
    readonly calls: readonly string[];
    readonly output: ProcessOutput;
    readonly data: (text: string) => void;
    readonly exit: (code: number, signal: number | undefined) => void;
};
export function processLaunch(kind: 'pipes' | 'pty'): ProcessLaunch {
    const common = {
        command: [ 'node', 'fixture.js' ] as const,
        cwd: '/fixture',
        env: null,
        completion: { kind: 'exit', readiness: null, steps: [], expectedExitCodes: [ 0 ] } as const
    };
    return {
        request: kind === 'pipes' ? { ...common, kind } : { ...common, kind, name: 'fixture', columns: 80, rows: 24 },
        arguments: [ 'fixture.js' ],
        environment: {},
        output: processOutput(kind, capturedOutputBytes)
    };
}
export function pipeProcess(writeFailure: Error | null, pid: number | undefined): PipeFixture {
    const events = new EventEmitter();
    const input: string[] = [];
    const stdin = new Writable({
        write(chunk: Buffer, _encoding, done) {
            input.push(chunk.toString());
            done(writeFailure);
        }
    });
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const launch = processLaunch('pipes');
    const child = launchPipeProcess(launch, {
        now() {
            return exitTime;
        },
        spawn() {
            return Object.assign(events, { pid, stdin, stdout, stderr });
        }
    });
    return {
        child,
        events,
        input,
        stdin,
        stdout,
        stderr,
        output: launch.output,
        receive(out, err) {
            stdout.emit('data', Buffer.from(out));
            stderr.emit('data', Buffer.from(err));
        },
        finish(code, signal) {
            events.emit('exit', code, signal);
            events.emit('close');
        }
    };
}
export function terminalProcess(): TerminalFixture {
    const data = createStoredValue<(text: string) => void>(function () {
        return undefined;
    });
    const exit = createStoredValue<Parameters<IPty['onExit']>[0]>(
        function () {
            return undefined;
        }
    );
    const calls: string[] = [];
    const launch = processLaunch('pty');
    const child = launchTerminalProcess(launch, {
        now() {
            return exitTime;
        },
        spawn() {
            return {
                pid: 42,
                onData(receive) {
                    data.write(function (text) {
                        receive(text);
                    });
                    return {
                        dispose() {
                            return undefined;
                        }
                    };
                },
                onExit(receive) {
                    exit.write(function (value) {
                        receive(value);
                    });
                    return {
                        dispose() {
                            return undefined;
                        }
                    };
                },
                write(text) {
                    calls.push(`write:${text}`);
                },
                resize(columns, rows) {
                    calls.push(`resize:${columns}:${rows}`);
                }
            };
        }
    });
    return {
        child,
        calls,
        output: launch.output,
        data(text: string) {
            data.read()(text);
        },
        exit(code: number, signal: number | undefined) {
            exit.read()({ exitCode: code, ...signal === undefined ? {} : { signal } });
        }
    };
}
export function stoppedProcess(pid: number | null): ProcessChild {
    return {
        pid,
        exit: Promise.resolve({ code: 0, signal: null, time: exitTime }),
        closed: Promise.resolve(),
        async write() {
            return undefined;
        },
        closeInput() {
            return undefined;
        },
        resize() {
            return undefined;
        }
    };
}
