import { discoverRunFilesWithProjectRoot } from './run-discovery.ts';
import { selectedProfile } from './run-facts.ts';
import {
    copyRunEngineSelection,
    copyRunConfig,
    copyRunRequest,
    freezeValue
} from './run-support.ts';
import type {
    RunCommand,
    RunConfig,
    RunMicrotestProfileConfig,
    RunRequest
} from './run-types.ts';
import {
    assertSupportedProcessEngine,
    validateRunInput
} from './run-validation.ts';

export type ResolvedRunInput = {
    readonly config: RunConfig;
    readonly engine: RunCommand['engine'];
    readonly files: Awaited<ReturnType<typeof discoverRunFilesWithProjectRoot>>['files'];
    readonly profile: RunMicrotestProfileConfig;
    readonly projectRoot: string;
    readonly request: RunRequest;
};

export async function readResolvedRunInput(command: RunCommand): Promise<ResolvedRunInput> {
    validateRunInput(command);
    const request = freezeValue(copyRunRequest(command.request));
    const config = freezeValue(copyRunConfig(command.config));
    const profile = selectedProfile(request, config);
    assertSupportedProcessEngine(command, profile);
    const discovery = freezeValue(
        await discoverRunFilesWithProjectRoot({
            cwd: command.cwd,
            paths: request.paths,
            profileFiles: profile.files
        })
    );
    const engine = freezeValue(copyRunEngineSelection(command.engine));

    return { config, engine, files: discovery.files, profile, projectRoot: discovery.projectRoot, request };
}
