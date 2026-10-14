import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sanitizedChildEnvironment } from './supervised-child-process.ts';
import { executionReplySchema } from './execution-session-schema.ts';
import {
    executionSessionProcessArgument,
    executionSessionProcessUrl,
    readExecutionSessionEnvironment
} from './execution-session-process.entry-point.ts';
import type { FrozenRunCommand } from './run-types.ts';
import type { RunExecutionReply } from './execution-session-types.ts';
import type { RunExecutionTransport } from './execution-session-context.ts';

export async function runFreshExecutionSession(
    command: FrozenRunCommand,
    transport: RunExecutionTransport,
    timeoutMilliseconds: number,
    signal: AbortSignal
): Promise<RunExecutionReply> {
    signal.throwIfAborted();
    const child = fork(fileURLToPath(executionSessionProcessUrl), [ executionSessionProcessArgument ], {
        cwd: command.policy.cwd,
        env: sanitizedChildEnvironment(readExecutionSessionEnvironment(), 'microtest'),
        execArgv: [],
        serialization: 'advanced',
        killSignal: 'SIGKILL',
        signal,
        stdio: [ 'ignore', 'pipe', 'pipe', 'ipc' ]
    });
    child.stdout?.resume();
    child.stderr?.resume();
    const closed = new Promise<void>(function (resolve) {
        child.once('close', resolve);
    });
    try {
        return await new Promise<RunExecutionReply>(function (resolve, reject) {
            child.once('error', reject);
            child.once(
                'exit',
                function (code, termination) {
                    reject(
                        new Error(`Execution host exited without a result (${String(code)}, ${String(termination)}).`)
                    );
                }
            );
            child.once('message', function (message) {
                try {
                    resolve(executionReplySchema.parse(message));
                } catch (error: unknown) {
                    reject(
                        error instanceof Error
                            ? error
                            : new Error('Execution host returned an invalid reply.', { cause: error })
                    );
                }
            });
            child.send(
                {
                    policy: command.policy,
                    seed: command.invocation.seed,
                    selection: command.invocation.selection,
                    transport,
                    timeoutMilliseconds
                },
                function (error) {
                    if (error !== null) {
                        reject(error);
                    }
                }
            );
        });
    } finally {
        child.kill('SIGKILL');
        await closed;
    }
}
