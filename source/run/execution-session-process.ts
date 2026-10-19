import { fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sanitizedChildEnvironment } from './supervised-child-process.ts';
import { executionHostMessageSchema } from './execution-session-schema.ts';
import type { ExecutionSessionObservation } from './execution-session-runtime-types.ts';
import {
    executionSessionProcessArgument,
    executionSessionProcessUrl,
    readExecutionSessionEnvironment
} from './execution-session-process.entry-point.ts';
import type { FrozenRunCommand } from './run-types.ts';
import type { RunExecutionReply } from './execution-session-types.ts';
import type { RunExecutionTransport } from './execution-session-context.ts';

type HostMessageDelivery = {
    readonly observation: ExecutionSessionObservation;
    readonly pending: Readonly<Set<Promise<void>>>;
    readonly resolve: (reply: RunExecutionReply) => void;
    readonly reject: (error: unknown) => void;
};
type ExecutionCheckpoint = Extract<
    ReturnType<typeof executionHostMessageSchema.parse>,
    { readonly kind: 'execution-checkpoint'; }
>;
async function deliverCheckpoint(
    message: Readonly<ExecutionCheckpoint>,
    delivery: HostMessageDelivery
): Promise<void> {
    try {
        await delivery.observation.checkpoint(message.data);
    } catch (error: unknown) {
        delivery.reject(error);
    }
}
function deliverHostMessage(message: unknown, delivery: HostMessageDelivery): void {
    const decoded = executionHostMessageSchema.parse(message);
    if (decoded.kind === 'execution-checkpoint') {
        delivery.pending.add(deliverCheckpoint(decoded, delivery));
    } else {
        delivery.resolve(decoded);
    }
}

type FreshExecutionHost = {
    readonly child: ChildProcess;
    readonly closed: Promise<void>;
    readonly pending: Readonly<Set<Promise<void>>>;
};
function startFreshExecutionHost(command: FrozenRunCommand, signal: Readonly<AbortSignal>): FreshExecutionHost {
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
    return { child, closed, pending: new Set() };
}

export async function runFreshExecutionSession(
    command: FrozenRunCommand,
    transport: RunExecutionTransport,
    timeoutMilliseconds: number,
    observation: ExecutionSessionObservation
): Promise<RunExecutionReply> {
    const { child, closed, pending } = startFreshExecutionHost(command, observation.signal);
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
            child.on('message', function (message) {
                try {
                    deliverHostMessage(message, { observation, pending, resolve, reject });
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
        await Promise.all(pending);
    }
}
