import { copyConfig } from '../config/snapshot.ts';
import type { NormalizedConfig, TestProfileConfig } from '../config/types.ts';
import { selectTestProfile } from './test-profile.ts';
import { copyRunEngineSelection, freezeValue } from './run-support.ts';
import { copyRunRequest } from './request-snapshot.ts';
import type { RunCommand, RunRequest } from './run-types.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import {
    assertSupportedProcessEngine,
    validateRunInput
} from './run-validation.ts';
import { invalidRequest } from './run-errors.ts';

export type ResolvedRunInput = {
    readonly config: NormalizedConfig;
    readonly engine: RunCommand['engine'];
    readonly files: Awaited<ReturnType<RunOrchestratorDependencies['discoverRunFilesWithProjectRoot']>>['files'];
    readonly profile: TestProfileConfig;
    readonly projectRoot: string;
    readonly request: RunRequest;
};

function assertMicrotestCaptureSupported(
    request: RunRequest,
    profile: TestProfileConfig
): void {
    if (profile.testFamily === 'microtest' && request.capture === 'live') {
        invalidRequest('Microtest profiles do not support live capture.');
    }
}

function assertWorkerCountSupported(request: RunRequest, profile: TestProfileConfig): void {
    if (request.workers !== null && profile.execution.processModel !== 'worker-pool') {
        invalidRequest('Worker count can only be requested for worker-pool profiles.');
    }
}

function assertCoverageSupported(request: RunRequest, profile: TestProfileConfig): void {
    if (request.coverage && profile.testFamily !== 'microtest') {
        invalidRequest('Coverage can only be requested for microtest profiles.');
    }
}

function assertProfileRequestSupported(request: RunRequest, profile: TestProfileConfig): void {
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
    const config = freezeValue(copyConfig(command.config));
    const profile = selectTestProfile(request.profile, config);
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
