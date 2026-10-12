import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ConfigError } from '../run/config.entry-point.ts';
import { RunResolutionError, type FrozenMicrotestPolicy } from '../run/run.entry-point.ts';
import {
    mutationPolicyProcessArgument,
    mutationPolicyProcessUrl,
    readMutationPolicyEnvironment
} from './mutation-policy-process.entry-point.ts';
import { mutationPolicyResponseSchema } from './mutation-policy-protocol.ts';
import type { OverkillRunnerOptions } from './runner-options.ts';
import type { MutationSandbox } from './mutation-sandbox.ts';

type MutationPolicyInitialization = {
    readonly sandbox: MutationSandbox | null;
    readonly cwd: string;
    readonly settings: OverkillRunnerOptions;
    readonly signal: AbortSignal;
};

function readPolicyResponse(message: unknown): FrozenMicrotestPolicy {
    const response = mutationPolicyResponseSchema.parse(message);
    if (response.kind === 'policy') {
        return response.policy;
    }
    if (response.kind === 'config-error') {
        throw new ConfigError(response.message, {
            cause: response.cause === null ? undefined : new Error(response.cause)
        });
    }
    if (response.kind === 'resolution-error') {
        throw new RunResolutionError(response.message, undefined, response.code);
    }
    throw new Error(response.message);
}

export async function initializeMutationPolicy(input: MutationPolicyInitialization): Promise<FrozenMicrotestPolicy> {
    const child = fork(fileURLToPath(mutationPolicyProcessUrl), [ mutationPolicyProcessArgument ], {
        cwd: input.cwd,
        env: readMutationPolicyEnvironment(),
        execArgv: [],
        killSignal: 'SIGKILL',
        signal: input.signal,
        stdio: [ 'ignore', 'inherit', 'inherit', 'ipc' ]
    });
    const closed = new Promise<void>(function observeResolverClose(resolve) {
        child.once('close', function resolverClosed() {
            resolve();
        });
    });
    try {
        return await new Promise<FrozenMicrotestPolicy>(function receivePolicy(resolve, reject) {
            child.once('error', reject);
            child.once('exit', function resolverExited(code, signal) {
                reject(
                    new Error(`Mutation policy resolver exited without a result (${String(code)}, ${String(signal)}).`)
                );
            });
            child.once('message', function decodePolicy(message: unknown) {
                try {
                    resolve(readPolicyResponse(message));
                } catch (error: unknown) {
                    reject(
                        error instanceof Error
                            ? error
                            : new Error('Invalid mutation policy response.', { cause: error })
                    );
                }
            });
            child.send(
                { kind: 'resolve-policy', cwd: input.cwd, sandbox: input.sandbox, settings: input.settings },
                function policyRequestSent(error) {
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
