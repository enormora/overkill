import { loadConfig } from '../run/config.entry-point.ts';
import { orchestrator, withFileModuleBoundary } from '../run/run.entry-point.ts';
import { assertExcludedMutationFiles } from './mutation-sandbox.ts';
import { mutationPolicyRequestSchema, type MutationPolicyRequest } from './mutation-policy-protocol.ts';
import { resolveMutationPolicyRequest } from './mutation-policy-resolver.ts';

async function readPolicyRequest(): Promise<MutationPolicyRequest> {
    return new Promise(function receivePolicyRequest(resolve, reject) {
        process.once('message', function decodePolicyRequest(message: unknown) {
            try {
                resolve(mutationPolicyRequestSchema.parse(message));
            } catch (error: unknown) {
                reject(
                    error instanceof Error ? error : new Error('Invalid mutation policy request.', { cause: error })
                );
            }
        });
    });
}

async function resolveMutationPolicy(): Promise<void> {
    const input = await readPolicyRequest();
    const response = await resolveMutationPolicyRequest(input, {
        load: loadConfig,
        freeze: orchestrator.freezePolicy,
        boundary: withFileModuleBoundary,
        exclude: assertExcludedMutationFiles
    });
    await new Promise<void>(function deliverPolicy(resolve, reject) {
        if (process.send === undefined) {
            reject(new Error('Mutation policy resolver requires IPC.'));
            return;
        }
        process.send(response, function policyDelivered(error) {
            if (error === null) {
                resolve();
            } else {
                reject(error);
            }
        });
    });
    process.disconnect?.();
}

await resolveMutationPolicy();
