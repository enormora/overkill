import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { suite, test, type TestScope } from '../../packages/test/test.entry-point.ts';
import { createLineReporter } from '../../packages/reporter-line/reporter-line.entry-point.ts';
import { executeProcessCommand, type ProcessExecutionInput } from '../../bench/process-execution.ts';
import { parseProcessRequest } from '../../bench/process-command.ts';
import type { ProcessExecution } from '../../bench/process-protocol.ts';
import { runIfMain } from '#test-runner';

function command(scope: TestScope, source: string): ProcessExecutionInput {
    return {
        request: parseProcessRequest({
            command: [ process.execPath, '-e', source ],
            cwd: process.cwd(),
            env: null,
            io: { kind: 'pipes' },
            completion: { kind: 'exit', readiness: null, steps: [], expectedExitCodes: [ 0 ] }
        }),
        instrumentation: 'off',
        maximumBytes: 1024,
        signal: scope.signal,
        environment: { PARENT_VALUE: 'inherited' },
        started() {
            return undefined;
        }
    };
}

function measured(execution: ProcessExecution): Extract<ProcessExecution, { readonly status: 'measured'; }>['result'] {
    if (execution.status !== 'measured') {
        throw new Error(JSON.stringify(execution));
    }
    return execution.result;
}

function processExists(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error: unknown) {
        if (error instanceof Error && Reflect.get(error, 'code') === 'ESRCH') {
            return false;
        }
        throw error;
    }
}

async function assertStopped(scope: TestScope, pid: number): Promise<void> {
    for (let attempt = 0; attempt < 50 && processExists(pid); attempt += 1) {
        await wait(20);
    }
    scope.assert.false(processExists(pid));
}

export const testNode = suite('external-process ownership', [
    test('retains Node telemetry when a ready child exits before a snapshot reply', async function (scope: TestScope) {
        const input = command(scope, 'process.stdout.write("Ready");process.exit(0)');
        const result = measured(
            await executeProcessCommand({
                ...input,
                instrumentation: 'node',
                request: {
                    ...input.request,
                    kind: 'pipes',
                    completion: { kind: 'ready', marker: { stream: 'stdout', text: 'Ready' } }
                }
            })
        );
        scope.assert.equal(result.value.completion.kind, 'ready');
        scope.assert.equal(result.metrics.processCpuTotalMicroseconds.availability, 'available');
        return scope.assert.collect();
    }),
    test(
        'preserves literal arguments and controls cwd and environment without a shell',
        async function (scope: TestScope) {
            const directory = await realpath(await mkdtemp(join(tmpdir(), 'overkill-command-')));
            scope.cleanup(async function removeDirectory() {
                await rm(directory, { recursive: true, force: true });
            });
            const input = command(
                scope,
                'console.log(JSON.stringify([process.cwd(),process.argv.slice(1),process.env.CHILD,process.env.PARENT_VALUE]))'
            );
            const result = measured(
                await executeProcessCommand({
                    ...input,
                    request: {
                        ...input.request,
                        command: [
                            ...input
                                .request
                                .command,
                            'one two',
                            '$HOME'
                        ],
                        cwd: directory,
                        env: { CHILD: 'only' }
                    }
                })
            );
            scope.assert.partialDeepEqual(result.value.output, {
                kind: 'pipes',
                stdout: { text: `${JSON.stringify([ directory, [ 'one two', '$HOME' ], 'only', null ])}\n` }
            });
            return scope.assert.collect();
        }
    ),
    test('inherits the supplied environment when env is null', async function (scope: TestScope) {
        const result = measured(
            await executeProcessCommand(command(scope, 'process.stdout.write(process.env.PARENT_VALUE)'))
        );
        scope.assert.partialDeepEqual(result.value.output, { kind: 'pipes', stdout: { text: 'inherited' } });
        scope.assert.equal(result.metrics.startupMilliseconds.availability, 'unavailable');
        return scope.assert.collect();
    }),
    test('accepts declared exit codes and reports silent output as unavailable', async function (scope: TestScope) {
        const input = command(scope, 'process.exit(7)');
        const result = measured(
            await executeProcessCommand({
                ...input,
                request: {
                    ...input.request,
                    completion: { kind: 'exit', readiness: null, steps: [], expectedExitCodes: [ 7 ] }
                }
            })
        );
        scope.assert.deepEqual(result.value.completion, { kind: 'exit', code: 7 });
        scope.assert.equal(result.metrics.firstOutputMilliseconds.availability, 'unavailable');
        scope.assert.equal(result.metrics.residentSetBytes.availability, 'unavailable');
        return scope.assert.collect();
    }),
    test('retains output on unexpected signals and rejects missing executables', async function (scope: TestScope) {
        const signalled = await executeProcessCommand(
            command(scope, 'console.error("before-signal");process.kill(process.pid,"SIGTERM")')
        );
        scope.assert.partialDeepEqual(signalled, {
            status: 'failed',
            output: { kind: 'pipes', stderr: { text: 'before-signal\n' } }
        });
        const input = command(scope, '');
        const missing = await executeProcessCommand({
            ...input,
            request: { ...input.request, command: [ '/overkill-missing-executable' ] }
        });
        scope.assert.equal(missing.status, 'failed');
        return scope.assert.collect();
    }),
    test('does not launch pre-aborted commands', async function (scope: TestScope) {
        const controller = new AbortController();
        controller.abort(new Error('cancelled before launch'));
        let starts = 0;
        const result = await executeProcessCommand({
            ...command(scope, 'setInterval(()=>{},1000)'),
            signal: controller.signal,
            started() {
                starts += 1;
            }
        });
        scope.assert.partialDeepEqual(result, { status: 'failed', message: 'cancelled before launch' });
        scope.assert.equal(starts, 0);
        return scope.assert.collect();
    }),
    test('cancels a running command and reaps its process', async function (scope: TestScope) {
        const controller = new AbortController();
        let pid = 0;
        const result = await executeProcessCommand({
            ...command(scope, 'setInterval(()=>{},1000)'),
            signal: controller.signal,
            started(value) {
                pid = value;
                controller.abort(new Error('cancelled after launch'));
            }
        });
        scope.assert.partialDeepEqual(result, {
            status: 'failed',
            message: 'cancelled after launch',
            cleanupFailure: null
        });
        scope.assert.true(pid > 0);
        await assertStopped(scope, pid);
        return scope.assert.collect();
    }),
    test(
        'forces shutdown after readiness when the child ignores graceful termination',
        async function (scope: TestScope) {
            const input = command(scope, 'process.on("SIGTERM",()=>{});console.log("Ready");setInterval(()=>{},1000)');
            let pid = 0;
            const execution = await executeProcessCommand({
                ...input,
                started(value) {
                    pid = value;
                },
                request: {
                    ...input.request,
                    kind: 'pipes',
                    completion: { kind: 'ready', marker: { stream: 'stdout', text: 'Ready' } }
                }
            });
            scope.assert.equal(measured(execution).value.completion.kind, 'ready');
            scope.assert.equal(execution.cleanupFailure, null);
            await assertStopped(scope, pid);
            return scope.assert.collect();
        }
    ),
    test('terminates descendants in the owned process group', async function (scope: TestScope) {
        const input = command(
            scope,
            'const {spawn}=require("node:child_process");const child=spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"});console.log("child="+child.pid);console.log("Ready");setInterval(()=>{},1000)'
        );
        const result = measured(
            await executeProcessCommand({
                ...input,
                request: {
                    ...input.request,
                    kind: 'pipes',
                    completion: { kind: 'ready', marker: { stream: 'stdout', text: 'Ready' } }
                }
            })
        );
        if (result.value.output.kind !== 'pipes') {
            throw new Error('Expected pipe output.');
        }
        const child = /child=(?<pid>\d+)/u.exec(result.value.output.stdout.text)?.groups?.pid;
        scope.require.defined(child);
        await assertStopped(scope, Number(child));
        return scope.assert.collect();
    }),
    test('rejects exits before requested readiness without hanging', async function (scope: TestScope) {
        const input = command(scope, 'console.log("banner only")');
        const result = await executeProcessCommand({
            ...input,
            request: {
                ...input.request,
                kind: 'pipes',
                completion: { kind: 'ready', marker: { stream: 'stdout', text: 'Ready' } }
            }
        });
        scope.assert.equal(result.status, 'failed');
        scope.assert.equal(result.cleanupFailure, null);
        return scope.assert.collect();
    })
]);

await runIfMain(import.meta, testNode, { reporters: [ createLineReporter() ] });
