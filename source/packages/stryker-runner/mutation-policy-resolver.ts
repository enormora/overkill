import { ConfigError, loadConfig } from '../run/config.entry-point.ts';
import { orchestrator, RunResolutionError, withFileModuleBoundary } from '../run/run.entry-point.ts';
import { selectMicrotestProfile } from './microtest-profile.ts';
import { createMutationRunCommand } from './mutation-execution-policy.ts';
import { mutationPolicyRequestSchema, type MutationPolicyResponse } from './mutation-policy-protocol.ts';
import { parseRunnerOptions } from './runner-settings-schema.ts';
import { assertExcludedMutationFiles, sandboxModuleBoundary, sandboxRunnerOptions } from './mutation-sandbox.ts';

async function readPolicyRequest(): Promise<ReturnType<typeof mutationPolicyRequestSchema.parse>> {
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

async function createPolicy(): Promise<MutationPolicyResponse> {
    const input = await readPolicyRequest();
    const parsedSettings = parseRunnerOptions(input.settings);
    const { sandbox } = input;
    if (sandbox !== null && sandbox.root !== input.cwd) {
        throw new ConfigError('Mutation sandbox conflicts with resolver cwd.');
    }
    const settings = sandbox === null ? parsedSettings : sandboxRunnerOptions(sandbox, parsedSettings);
    const moduleBoundary = sandbox === null ? null : sandboxModuleBoundary(sandbox);
    return await withFileModuleBoundary(moduleBoundary, async function freezeSandboxPolicy() {
        const request = { configPath: settings.configPath, cwd: input.cwd };
        const config = await loadConfig(request);
        if (sandbox !== null && config.configPath !== null) {
            await assertExcludedMutationFiles(sandbox, [ config.configPath ], 'configuration');
        }
        const selected = selectMicrotestProfile(config, settings.profile);
        const command = createMutationRunCommand({ config, cwd: input.cwd, profile: selected.name });
        const policy = await orchestrator.freezePolicy({
            moduleBoundary,
            command: { ...command, request: { ...command.request, paths: settings.paths } },
            source: { kind: 'config-file', request, resolvedPath: config.configPath }
        });
        if (sandbox !== null) {
            await assertExcludedMutationFiles(
                sandbox,
                policy.files.map(function testModule(file) {
                    return file.path;
                }),
                'test definitions'
            );
        }
        return { kind: 'policy', policy };
    });
}

function failureResponse(error: unknown): MutationPolicyResponse {
    if (error instanceof ConfigError) {
        return {
            kind: 'config-error',
            message: error.message,
            cause: error.cause instanceof Error ? error.cause.message : null
        };
    }
    if (error instanceof RunResolutionError) {
        return { kind: 'resolution-error', message: error.message, code: error.code() };
    }
    return { kind: 'error', message: error instanceof Error ? error.message : String(error) };
}

async function policyResponse(): Promise<MutationPolicyResponse> {
    try {
        return await createPolicy();
    } catch (error: unknown) {
        return failureResponse(error);
    }
}

async function resolveMutationPolicy(): Promise<void> {
    const response = await policyResponse();
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
