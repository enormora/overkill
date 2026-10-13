import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { Except } from 'type-fest';
import type { RunOrchestrator } from '../run/run.entry-point.ts';
import {
    mutationInvocationProcessArgument,
    mutationInvocationProcessUrl,
    readMutationInvocationEnvironment
} from './mutation-invocation-process.entry-point.ts';
import { restoreMutationInvocationFailure } from './mutation-invocation-failure.ts';
import { mutationInvocationResponseSchema, type MutationInvocationRequest } from './mutation-invocation-protocol.ts';

type FreshMutationInvocation = Readonly<Except<MutationInvocationRequest, 'kind'>> & { readonly signal: AbortSignal; };
type RunResult = Awaited<ReturnType<RunOrchestrator['run']>>;

function readInvocationResult(message: unknown): RunResult {
    const response = mutationInvocationResponseSchema.parse(message);
    if (response.kind === 'failure') {
        throw restoreMutationInvocationFailure(response.failure);
    }
    return response.result;
}

export async function runFreshMutationInvocation(input: FreshMutationInvocation): Promise<RunResult> {
    input.signal.throwIfAborted();
    const child = fork(fileURLToPath(mutationInvocationProcessUrl), [ mutationInvocationProcessArgument ], {
        cwd: input.policy.cwd,
        env: readMutationInvocationEnvironment(),
        execArgv: [],
        serialization: 'advanced',
        killSignal: 'SIGKILL',
        signal: input.signal,
        stdio: [ 'ignore', 'inherit', 'inherit', 'ipc' ]
    });
    const closed = new Promise<void>(function observeInvocationClose(resolve) {
        child.once('close', function invocationClosed() {
            resolve();
        });
    });
    try {
        return await new Promise<RunResult>(function receiveInvocationResult(resolve, reject) {
            child.once('error', reject);
            child.once('exit', function invocationExited(code, signal) {
                reject(new Error(`Mutation invocation exited without a result (${String(code)}, ${String(signal)}).`));
            });
            child.once('message', function decodeInvocation(message: unknown) {
                try {
                    resolve(readInvocationResult(message));
                } catch (error: unknown) {
                    reject(
                        error instanceof Error
                            ? error
                            : new Error('Invalid mutation invocation response.', { cause: error })
                    );
                }
            });
            const request: MutationInvocationRequest = {
                kind: 'run',
                policy: input.policy,
                seed: input.seed,
                selection: input.selection
            };
            child.send(request, function invocationRequestSent(error) {
                if (error !== null) {
                    reject(error);
                }
            });
        });
    } finally {
        child.kill('SIGKILL');
        await closed;
    }
}
