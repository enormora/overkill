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
    RunProfileConfig,
    RunRequest
} from './run-types.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import {
    assertSupportedProcessEngine,
    validateRunInput
} from './run-validation.ts';
import { invalidRequest } from './run-errors.ts';

export type ResolvedRunInput = {
    readonly config: RunConfig;
    readonly engine: RunCommand['engine'];
    readonly files: Awaited<ReturnType<RunOrchestratorDependencies['discoverRunFilesWithProjectRoot']>>['files'];
    readonly profile: RunProfileConfig;
    readonly projectRoot: string;
    readonly request: RunRequest;
};

function assertMicrotestCaptureSupported(
    request: RunRequest,
    profile: RunProfileConfig
): void {
    if (profile.testFamily === 'microtest' && request.capture === 'live') {
        invalidRequest('Microtest profiles do not support live capture.');
    }
}

function assertWorkerCountSupported(request: RunRequest, profile: RunProfileConfig): void {
    if (request.workers !== null && profile.execution.processModel !== 'worker-pool') {
        invalidRequest('Worker count can only be requested for worker-pool profiles.');
    }
}

function assertCoverageSupported(request: RunRequest, profile: RunProfileConfig): void {
    if (request.coverage && profile.testFamily !== 'microtest') {
        invalidRequest('Coverage can only be requested for microtest profiles.');
    }
}

function assertProfileRequestSupported(request: RunRequest, profile: RunProfileConfig): void {
    assertCoverageSupported(request, profile);
    assertMicrotestCaptureSupported(request, profile);
    assertWorkerCountSupported(request, profile);
}

export async function readResolvedRunInput(
    command: RunCommand,
    dependencies: RunOrchestratorDependencies
): Promise<ResolvedRunInput> {
    validateRunInput(command);
    const request = freezeValue(copyRunRequest(command.request));
    const config = freezeValue(copyRunConfig(command.config));
    const profile = selectedProfile(request, config);
    assertProfileRequestSupported(request, profile);
    assertSupportedProcessEngine(command, profile);
    const discovery = freezeValue(
        await dependencies.discoverRunFilesWithProjectRoot({
            cwd: command.cwd,
            paths: request.paths,
            profileFiles: profile.files
        })
    );
    const engine = freezeValue(copyRunEngineSelection(command.engine));

    return { config, engine, files: discovery.files, profile, projectRoot: discovery.projectRoot, request };
}
