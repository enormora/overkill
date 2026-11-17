import { runIfMain } from '#test-runner';
import { suite, test, testDouble, type TestScope } from '../packages/test/test.entry-point.ts';
import { pipeProcess, terminalProcess, processLaunch, stoppedProcess } from '../test-support/process-child-runtime.ts';
import { launchPipeProcess, launchTerminalProcess, sendProcessGroupSignal, stopProcessChild } from './process-child.ts';
import { ProcessDeadlineError } from './process-deadline.ts';

export const testNode = suite('process transport ownership', [
    test('captures separate pipe streams and waits for output closure', async function (scope: TestScope) {
        const fixture = pipeProcess(null, 42);
        fixture.receive('output', 'warning');
        await fixture.child.write('input');
        fixture.child.closeInput();
        fixture.finish(0, null);
        const [ exit ] = await Promise.all([ fixture.child.exit, fixture.child.closed ]);
        scope.assert.deepEqual(exit, { code: 0, signal: null, time: 1234n });
        scope.assert.deepEqual({ pid: fixture.child.pid, input: fixture.input, ended: fixture.stdin.writableEnded }, {
            pid: 42,
            input: [ 'input' ],
            ended: true
        });
        scope.assert.partialDeepEqual(fixture.output.snapshot(), {
            stdout: { text: 'output' },
            stderr: { text: 'warning' }
        });
        return scope.assert.collect();
    }),
    test('rejects resizing a pipe process', function (scope: TestScope) {
        const fixture = pipeProcess(null, 42);
        fixture.finish(0, null);
        scope.assert.throws(function () {
            fixture.child.resize(1, 1);
        }, { message: 'Pipe commands cannot resize a terminal.' });
        return scope.assert.collect();
    }),
    test('retains missing process ids and signal termination', async function (scope: TestScope) {
        const fixture = pipeProcess(null, undefined);
        fixture.events.emit('exit', null, 'SIGTERM');
        fixture.events.emit('close');
        scope.assert.equal(fixture.child.pid, null);
        scope.assert.deepEqual(await fixture.child.exit, { code: null, signal: 'SIGTERM', time: 1234n });
        await fixture.child.closed;
        return scope.assert.collect();
    }),
    ...([ 'child', 'input', 'write' ] as const).map(function (failure) {
        return test(`propagates ${failure} failures`, async function (scope: TestScope) {
            const error = new Error(failure);
            const fixture = pipeProcess(failure === 'write' ? error : null, 42);
            const exit = scope.assert.rejects(async function () {
                return await fixture.child.exit;
            }, { exact: error });
            if (failure === 'write') {
                await scope.assert.rejects(async function () {
                    await fixture.child.write('input');
                }, { exact: error });
            } else if (failure === 'input') {
                fixture.stdin.emit('error', error);
            } else {
                fixture.events.emit('error', error);
            }
            fixture.events.emit('close');
            await Promise.all([ exit, fixture.child.closed ]);
            return scope.assert.collect();
        });
    }),
    test('propagates synchronous launcher failures before creating pending observations', function (scope: TestScope) {
        const error = new Error('spawn failed');
        scope.assert.throws(function () {
            launchPipeProcess(processLaunch('pipes'), {
                now() {
                    return 0n;
                },
                spawn() {
                    throw error;
                }
            });
        }, { exact: error });
        scope.assert.throws(function () {
            launchTerminalProcess(processLaunch('pty'), {
                now() {
                    return 0n;
                },
                spawn() {
                    throw error;
                }
            });
        }, { exact: error });
        return scope.assert.collect();
    }),
    ...([ undefined, 0, 15 ] as const).map(function (signal) {
        return test(`captures terminal output and exit signal ${String(signal)}`, async function (scope: TestScope) {
            const fixture = terminalProcess();
            fixture.data('ready');
            await fixture.child.write('answer');
            fixture.child.resize(90, 30);
            fixture.exit(7, signal);
            scope.assert.deepEqual(await fixture.child.exit, {
                code: signal === 15 ? null : 7,
                signal: signal === 15 ? '15' : null,
                time: 1234n
            });
            await fixture.child.closed;
            scope.assert.partialDeepEqual({ calls: fixture.calls, output: fixture.output.snapshot() }, {
                calls: [ 'write:answer', 'resize:90:30' ],
                output: { terminal: { text: 'ready' } }
            });
            scope.assert.throws(function () {
                fixture.child.closeInput();
            }, { message: 'PTY commands cannot close only their input.' });
            return scope.assert.collect();
        });
    }),
    test('rejects pipe input at the terminal boundary', function (scope: TestScope) {
        scope.assert.throws(function () {
            launchTerminalProcess(processLaunch('pipes'), {
                now() {
                    return 0n;
                },
                spawn() {
                    throw new Error('must not spawn');
                }
            });
        }, { message: 'Terminal execution requires PTY options.' });
        return scope.assert.collect();
    }),
    test('signals the process group and ignores a missing process', function (scope: TestScope) {
        const sent: unknown[] = [];
        function send(pid: number, signal: string): void {
            sent.push({ pid, signal });
        }
        sendProcessGroupSignal(null, 'SIGTERM', send);
        sendProcessGroupSignal(42, 'SIGKILL', send);
        scope.assert.deepEqual(sent, [ { pid: -42, signal: 'SIGKILL' } ]);
        sendProcessGroupSignal(42, 'SIGTERM', function () {
            throw Object.assign(new Error('gone'), { code: 'ESRCH' });
        });
        return scope.assert.collect();
    }),
    ...([ new Error('permission'), 'invalid' ] as const).map(function (error) {
        return test(`preserves signal failure ${String(error)}`, function (scope: TestScope) {
            scope.assert.throws(function () {
                sendProcessGroupSignal(42, 'SIGTERM', function () {
                    testDouble.throws<() => void>(error)();
                });
            }, { exact: error });
            return scope.assert.collect();
        });
    }),
    ...([ 'graceful', 'deadline', 'error', 'close-error' ] as const).map(function (kind) {
        return test(`owns ${kind} shutdown`, async function (scope: TestScope) {
            const calls: string[] = [];
            const error = new Error('shutdown failure');
            let deadlines = 0;
            const pending = stopProcessChild(stoppedProcess(42), {
                signal(pid, signal) {
                    calls.push(`${pid}:${signal}`);
                },
                async deadline(value, milliseconds, message) {
                    deadlines += 1;
                    calls.push(`deadline:${milliseconds}:${message}`);
                    if (kind === 'deadline' && deadlines === 1) {
                        throw new ProcessDeadlineError('late', {});
                    }
                    if (deadlines === { graceful: 0, deadline: 0, error: 1, 'close-error': 2 }[kind]) {
                        throw error;
                    }
                    return await value;
                }
            });
            if (kind === 'error' || kind === 'close-error') {
                await scope.assert.rejects(async function () {
                    await pending;
                }, { exact: error });
            } else {
                await pending;
            }
            scope.assert.equal(deadlines, kind === 'error' ? 1 : 2);
            scope.assert.deepEqual(
                calls.filter(function (value) {
                    return !value.startsWith('deadline');
                }),
                [ '42:SIGTERM', '42:SIGKILL' ]
            );
            return scope.assert.collect();
        });
    })
]);
await runIfMain(import.meta, testNode);
