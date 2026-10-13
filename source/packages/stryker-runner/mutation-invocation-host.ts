import { normalizeConfig, orchestrator, type FrozenRunCommand } from '../run/run.entry-point.ts';
import { mutationInvocationFailure } from './mutation-invocation-failure.ts';
import {
    mutationInvocationRequestSchema,
    mutationInvocationResponseSchema,
    type MutationInvocationRequest,
    type MutationInvocationResponse
} from './mutation-invocation-protocol.ts';

async function readInvocation(): Promise<MutationInvocationRequest> {
    return await new Promise(function receiveInvocation(resolve, reject) {
        process.once('message', function decodeInvocation(message: unknown) {
            try {
                resolve(mutationInvocationRequestSchema.parse(message));
            } catch (error: unknown) {
                reject(
                    error instanceof Error ? error : new Error('Invalid mutation invocation request.', { cause: error })
                );
            }
        });
    });
}

async function executeInvocation(): Promise<MutationInvocationResponse> {
    try {
        const input = await readInvocation();
        const { outputRenderer } = normalizeConfig({});
        const command: FrozenRunCommand = {
            kind: 'frozen-policy',
            policy: input.policy,
            invocation: { seed: input.seed, selection: { kind: 'all' } },
            reporting: { outputRenderer, reporters: [] }
        };
        const initialized = await orchestrator.initialize(command);
        const collected = await initialized.collect();
        return { kind: 'result', result: await collected.run({ selection: input.selection }) };
    } catch (error: unknown) {
        return { kind: 'failure', failure: mutationInvocationFailure(error) };
    }
}

async function deliverInvocation(): Promise<void> {
    const response = mutationInvocationResponseSchema.parse(await executeInvocation());
    await new Promise<void>(function sendInvocationResult(resolve, reject) {
        if (process.send === undefined) {
            reject(new Error('Mutation invocation requires IPC.'));
            return;
        }
        process.send(response, function invocationResultSent(error) {
            if (error === null) {
                resolve();
            } else {
                reject(error);
            }
        });
    });
    process.disconnect?.();
}

await deliverInvocation();
