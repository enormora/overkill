import { copyConfig } from '../config/snapshot.ts';
import type { NormalizedConfig, ProfileConfig } from '../config/types.ts';
import { readCollectionFiles } from './run-collection-source.ts';
import { copyRunEngineSelection, freezeValue } from './run-support.ts';
import { selectBenchmarkProfile, selectTestProfile } from './test-profile.ts';
import { copyRunRequest } from './request-snapshot.ts';
import type { RunCommand, RunRequest, RunCollectionSource, RunFacts } from './run-types.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import {
    assertProfileRequestSupported,
    assertSupportedProcessEngine,
    validateRunInput
} from './run-validation.ts';

export type RunInputResolutionDependencies = Pick<
    RunOrchestratorDependencies,
    'createHistoryStorage' | 'discoverRunFilesWithProjectRoot' | 'wallClock'
>;

export type RunInvocation = {
    readonly command: RunCommand;
    readonly namespace: 'bench' | 'bench-calibrate' | 'test';
};

export type ResolvedRunInput = {
    readonly benchmarkPurpose: 'capture' | 'compare';
    readonly benchmarkHost: RunFacts['benchmarkHost'];
    readonly benchmarkCalibration: RunFacts['benchmarkCalibration'];
    readonly benchmarkNormalization: RunFacts['benchmarkNormalization'];
    readonly config: NormalizedConfig;
    readonly engine: RunCommand['engine'];
    readonly files: Awaited<ReturnType<RunOrchestratorDependencies['discoverRunFilesWithProjectRoot']>>['files'];
    readonly profile: ProfileConfig;
    readonly projectRoot: string;
    readonly request: RunRequest;
};

export async function readRunPolicyInput(
    invocation: RunInvocation,
    dependencies: Pick<RunInputResolutionDependencies, 'discoverRunFilesWithProjectRoot'>,
    source: RunCollectionSource
): Promise<ResolvedRunInput> {
    const { command, namespace } = invocation;
    validateRunInput(command);
    const request = freezeValue(copyRunRequest(command.request));
    const config = freezeValue(copyConfig(command.config));
    const profile = namespace === 'test'
        ? selectTestProfile(request.profile, config)
        : selectBenchmarkProfile(request.profile, config);
    assertProfileRequestSupported(request, profile, namespace, config.reporters);
    assertSupportedProcessEngine(command, profile);
    const engine = freezeValue(copyRunEngineSelection(command.engine));
    const discovery = freezeValue(await readCollectionFiles(command, profile, dependencies, source));
    return {
        benchmarkPurpose: namespace === 'bench-calibrate' ? 'capture' : 'compare',
        benchmarkHost: null,
        benchmarkCalibration: null,
        benchmarkNormalization: null,
        config,
        engine,
        files: discovery.files,
        profile,
        projectRoot: discovery.projectRoot,
        request
    };
}

export async function readResolvedRunInput(
    invocation: RunInvocation,
    dependencies: RunInputResolutionDependencies,
    source: RunCollectionSource
): Promise<ResolvedRunInput> {
    const input = await readRunPolicyInput(invocation, dependencies, source);
    if (!input.request.lastFailed || source.kind === 'frozen-policy') {
        return input;
    }
    const { readLastFailedSelection } = await import('./last-failed-selection.ts');
    const selection = await readLastFailedSelection(input.request.selection, input, dependencies);
    return { ...input, request: freezeValue({ ...input.request, selection }) };
}
