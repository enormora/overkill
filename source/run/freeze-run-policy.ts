import type { FreezePolicyInput, FrozenMicrotestPolicy } from './run-types.ts';
import { parseFrozenMicrotestPolicy } from './frozen-run-policy.ts';
import { readResolvedRunInput, type RunInputResolutionDependencies } from './run-input-resolution.ts';
import { configuredFilesRunCollectionSource } from './run-collection-source.ts';
import { RunResolutionError } from './run-errors.ts';
import { selectTestProfile } from './test-profile.ts';

export async function freezeRunPolicy(
    input: FreezePolicyInput,
    dependencies: RunInputResolutionDependencies
): Promise<FrozenMicrotestPolicy> {
    if (
        selectTestProfile(input.command.request.profile, input.command.config).testFamily !== 'microtest' ||
        input.command.engine.kind === 'instance'
    ) {
        throw new RunResolutionError(
            'Policy freezing requires a Node microtest profile and a portable engine.',
            undefined,
            'unsupported-request'
        );
    }
    const resolved = await readResolvedRunInput(
        { command: input.command, namespace: 'test' },
        dependencies,
        configuredFilesRunCollectionSource
    );
    if (resolved.profile.testFamily !== 'microtest' || resolved.engine.kind === 'instance') {
        throw new TypeError('Expected a portable microtest policy.');
    }
    const { reporters: _reporters, ...profile } = resolved.profile;
    const { seed: _seed, ...request } = resolved.request;
    return parseFrozenMicrotestPolicy({
        moduleBoundary: input.moduleBoundary,
        source: input.source,
        cwd: input.command.cwd,
        projectRoot: resolved.projectRoot,
        files: resolved.files,
        history: resolved.config.history,
        loader: resolved.config.loader,
        profile,
        request,
        engine: resolved.engine,
        runtimeStateDir: resolved.config.runtimeStateDir
    });
}
