import { ConfigError } from '../run/config.entry-point.ts';
import type { ConfigLoader } from '../../config/config-loader.ts';
import { type orchestrator, RunResolutionError, type withFileModuleBoundary } from '../run/run.entry-point.ts';
import { selectMicrotestProfile } from './microtest-profile.ts';
import { createMutationRunCommand } from './mutation-execution-policy.ts';
import type { MutationPolicyRequest, MutationPolicyResponse } from './mutation-policy-protocol.ts';
import { parseRunnerOptions } from './runner-settings-schema.ts';
import { type assertExcludedMutationFiles, sandboxModuleBoundary, sandboxRunnerOptions } from './mutation-sandbox.ts';

export type MutationPolicyRuntime = {
    readonly load: ConfigLoader;
    readonly freeze: typeof orchestrator.freezePolicy;
    readonly boundary: typeof withFileModuleBoundary;
    readonly exclude: typeof assertExcludedMutationFiles;
};
async function createPolicy(
    input: MutationPolicyRequest,
    runtime: MutationPolicyRuntime
): Promise<MutationPolicyResponse> {
    const parsedSettings = parseRunnerOptions(input.settings);
    const { sandbox } = input;
    if (sandbox !== null && sandbox.root !== input.cwd) {
        throw new ConfigError('Mutation sandbox conflicts with resolver cwd.');
    }
    const settings = sandbox === null ? parsedSettings : sandboxRunnerOptions(sandbox, parsedSettings);
    const moduleBoundary = sandbox === null ? null : sandboxModuleBoundary(sandbox);
    return await runtime.boundary(moduleBoundary, async function freezeSandboxPolicy() {
        const request = { configPath: settings.configPath, cwd: input.cwd };
        const config = await runtime.load(request);
        if (sandbox !== null && config.configPath !== null) {
            await runtime.exclude(sandbox, [ config.configPath ], 'configuration');
        }
        const selected = selectMicrotestProfile(config, settings.profile);
        const command = createMutationRunCommand({ config, cwd: input.cwd, profile: selected.name });
        const policy = await runtime.freeze({
            moduleBoundary,
            command: { ...command, request: { ...command.request, paths: settings.paths } },
            source: { kind: 'config-file', request, resolvedPath: config.configPath }
        });
        if (sandbox !== null) {
            await runtime.exclude(
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

export async function resolveMutationPolicyRequest(
    input: MutationPolicyRequest,
    runtime: MutationPolicyRuntime
): Promise<MutationPolicyResponse> {
    try {
        return await createPolicy(input, runtime);
    } catch (error: unknown) {
        return failureResponse(error);
    }
}
