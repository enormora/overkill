import { freezeProfileFamily } from './family-profile-transport.ts';
import { propertyReplayContext } from './run-support.ts';
import { currentExecutionSession, currentSnapshotRun } from './execution-session-context.ts';
import { assertDirectEntrypointCollectionMatches } from './direct-entrypoint-collection.ts';
import { inspectLocalTestPlan, type LocalTestPlan, type LocalTestPlanInput } from './run-local-test-plan.ts';
import { resolveProcessUsagePolicy, resolveRunScheduling } from './run-profile-facts.ts';
import type { RunCommand, CollectedRunPlan, RunRequest } from './run-types.ts';
import type {
    SupervisedCollectCommand,
    SupervisedExecutionMode,
    SupervisedRunCommand
} from './supervised-protocol.ts';
import type { WorkerPoolCommand } from './worker-pool-protocol.ts';
import { runCollectionContext, type CollectionSource } from './run-collection-source.ts';

type RunOrchestratorDependencies = LocalTestPlanInput['dependencies'];

export type IsolatedRunCollectionSource = CollectionSource;

const defaultRunSeed = 0n;

type IsolatedCommandEngine = Exclude<RunCommand['engine'], { readonly kind: 'instance'; }>;

type SupervisedCommandBase = {
    readonly snapshots: SupervisedRunCommand['snapshots'];
    readonly benchmarkNormalization: SupervisedRunCommand['benchmarkNormalization'];
    readonly benchmarkGarbageCollection: SupervisedRunCommand['benchmarkGarbageCollection'];
    readonly replay: SupervisedRunCommand['replay'];
    readonly seed: string;
    readonly propertyPolicy: SupervisedRunCommand['propertyPolicy'];
    readonly debug: RunRequest['debug'];
    readonly failureArtifacts: SupervisedRunCommand['failureArtifacts'];
    readonly retryPolicy: SupervisedRunCommand['retryPolicy'];
    readonly capabilityRestrictions: SupervisedRunCommand['capabilityRestrictions'];
    readonly capture: SupervisedRunCommand['capture'];
    readonly collectionTimeoutMilliseconds: number;
    readonly cwd: string;
    readonly definitionLocationCapture: SupervisedRunCommand['definitionLocationCapture'];
    readonly engine: IsolatedCommandEngine;
    readonly hardTimeoutMilliseconds: number;
    readonly maxConcurrency: SupervisedRunCommand['maxConcurrency'];
    readonly paths: readonly string[];
    readonly processBudgets: SupervisedRunCommand['processBudgets'];
    readonly processUsageSamplingIntervalMilliseconds: number;
    readonly root: SupervisedRunCommand['root'];
    readonly scheduling: SupervisedRunCommand['scheduling'];
    readonly family: SupervisedRunCommand['family'];
    readonly testFamily: SupervisedRunCommand['testFamily'];
    readonly timeoutMilliseconds: number;
};

type SupervisedCommandBaseInput = {
    readonly projectRoot: string;
    readonly benchmarkNormalization: SupervisedRunCommand['benchmarkNormalization'];
    readonly capture: RunRequest['capture'];
    readonly command: RunCommand;
    readonly definitionLocationCapture: SupervisedRunCommand['definitionLocationCapture'];
    readonly files: LocalTestPlanInput['files'];
    readonly profile: LocalTestPlanInput['profile'];
    readonly source: IsolatedRunCollectionSource;
};

export type WorkerPoolCommandInput = {
    readonly projectRoot: string;
    readonly benchmarkNormalization: SupervisedRunCommand['benchmarkNormalization'];
    readonly command: RunCommand;
    readonly definitionLocationCapture: SupervisedRunCommand['definitionLocationCapture'];
    readonly files: LocalTestPlanInput['files'];
    readonly profile: LocalTestPlanInput['profile'];
    readonly source: IsolatedRunCollectionSource;
};

function isolatedEngine(command: RunCommand): IsolatedCommandEngine {
    if (command.engine.kind === 'instance') {
        throw new Error('Instance engines cannot run in supervised children.');
    }

    return command.engine;
}

export async function createExpectedDirectEntrypointPlan(
    command: RunCommand,
    dependencies: RunOrchestratorDependencies,
    input: Pick<LocalTestPlanInput, 'files' | 'profile' | 'projectRoot'>,
    source: IsolatedRunCollectionSource
): Promise<LocalTestPlan['testPlan'] | null> {
    if (input.profile.execution.processModel !== 'in-process') {
        freezeProfileFamily({
            profile: input.profile,
            source,
            profileName: command.request.profile,
            projectRoot: input.projectRoot,
            definitionLocationCapture: 'enabled'
        });
    }
    return source.kind === 'direct-entrypoint'
        ? await inspectLocalTestPlan({
            command,
            definitionLocationCapture: 'enabled',
            dependencies,
            files: input.files,
            profile: input.profile,
            projectRoot: input.projectRoot,
            source
        })
        : null;
}

export function assertExpectedDirectEntrypointCollection(
    expected: LocalTestPlan['testPlan'] | null,
    actual: CollectedRunPlan
): void {
    if (expected !== null) {
        assertDirectEntrypointCollectionMatches(expected, actual);
    }
}

function supervisedCapabilityRestrictions(
    profile: LocalTestPlanInput['profile'],
    command: RunCommand
): SupervisedCommandBase['capabilityRestrictions'] {
    if (profile.testFamily !== 'microtest' && profile.testFamily !== 'property') {
        return { mode: 'disabled' };
    }

    return command.request.capabilityRestrictions;
}

function resolvedPaths(files: LocalTestPlanInput['files']): readonly string[] {
    return files.map(function toFilePath(file) {
        return file.file;
    });
}

function createSupervisedCommandBase(input: SupervisedCommandBaseInput): SupervisedCommandBase {
    const processUsagePolicy = resolveProcessUsagePolicy(input.command.request, input.profile);

    return {
        benchmarkNormalization: input.benchmarkNormalization,
        benchmarkGarbageCollection: input.profile.testFamily === 'benchmark' ? input.profile.garbageCollection : null,
        family: freezeProfileFamily({
            profile: input.profile,
            source: input.source,
            profileName: input.command.request.profile,
            projectRoot: input.projectRoot,
            definitionLocationCapture: input.definitionLocationCapture
        }),
        seed: (input.command.request.seed.value ?? defaultRunSeed).toString(),
        propertyPolicy: input.profile.testFamily === 'property' ? input.profile.property : null,
        capabilityRestrictions: supervisedCapabilityRestrictions(input.profile, input.command),
        capture: input.capture,
        snapshots: currentSnapshotRun(),
        collectionTimeoutMilliseconds: input.profile.timeouts.collectionMilliseconds,
        cwd: input.command.cwd,
        definitionLocationCapture: input.definitionLocationCapture,
        engine: isolatedEngine(input.command),
        hardTimeoutMilliseconds: input.profile.timeouts.hardMilliseconds,
        maxConcurrency: input.profile.execution.maxConcurrency,
        paths: resolvedPaths(input.files),
        processBudgets: processUsagePolicy.budgets,
        processUsageSamplingIntervalMilliseconds: processUsagePolicy.samplingIntervalMilliseconds,
        ...runCollectionContext(input.source, input.command.cwd, input.profile),
        scheduling: resolveRunScheduling(input.command.request, input.profile),
        debug: input.command.request.debug,
        failureArtifacts: input.profile.failureArtifacts,
        retryPolicy: input.profile.testFamily === 'integration' ? input.profile.retries : null,
        timeoutMilliseconds: input.profile.timeouts.softMilliseconds
    };
}

type SupervisedCollectionContext = {
    readonly projectRoot: string;
    readonly source: IsolatedRunCollectionSource;
    readonly normalization: SupervisedRunCommand['benchmarkNormalization'];
};
export function createSupervisedCollectCommand(
    command: RunCommand,
    profile: LocalTestPlanInput['profile'],
    files: LocalTestPlanInput['files'],
    context: SupervisedCollectionContext
): SupervisedCollectCommand {
    const { source, normalization: benchmarkNormalization } = context;
    return {
        ...createSupervisedCommandBase({
            projectRoot: context.projectRoot,
            benchmarkNormalization,
            capture: 'buffered',
            command,
            definitionLocationCapture: 'enabled',
            files,
            profile,
            source
        }),
        ...source.kind === 'frozen-policy'
            ? { kind: 'collect-frozen', policy: source.policy }
            : { kind: 'collect' }
    };
}

function supervisedExecutionMode(source: IsolatedRunCollectionSource): SupervisedExecutionMode {
    if (source.kind !== 'frozen-policy') {
        return { kind: 'run' };
    }
    const session = currentExecutionSession();
    return session === null
        ? { kind: 'run-frozen', policy: source.policy }
        : { kind: 'run-session', policy: source.policy, session };
}

export function createSupervisedRunCommand(
    command: RunCommand,
    profile: LocalTestPlanInput['profile'],
    files: LocalTestPlanInput['files'],
    context: SupervisedCollectionContext
): SupervisedRunCommand {
    const { source, normalization: benchmarkNormalization } = context;
    return {
        ...createSupervisedCommandBase({
            projectRoot: context.projectRoot,
            benchmarkNormalization,
            capture: command.request.capture,
            command,
            definitionLocationCapture: source.kind === 'direct-entrypoint' ? 'enabled' : 'disabled',
            files,
            profile,
            source
        }),
        ...supervisedExecutionMode(source),
        ...propertyReplayContext(command)
    };
}

export function createWorkerPoolCommand(
    input: WorkerPoolCommandInput
): WorkerPoolCommand {
    const processUsagePolicy = resolveProcessUsagePolicy(input.command.request, input.profile);

    return {
        capture: input.command.request.capture,
        snapshots: currentSnapshotRun(),
        family: freezeProfileFamily({
            profile: input.profile,
            source: input.source,
            profileName: input.command.request.profile,
            projectRoot: input.projectRoot,
            definitionLocationCapture: input.definitionLocationCapture
        }),
        seed: (input.command.request.seed.value ?? defaultRunSeed).toString(),
        benchmarkNormalization: input.benchmarkNormalization,
        benchmarkGarbageCollection: input.profile.testFamily === 'benchmark' ? input.profile.garbageCollection : null,
        attachmentEndpoint: null,
        debug: input.command.request.debug,
        failureArtifacts: input.profile.failureArtifacts,
        retryPolicy: input.profile.testFamily === 'integration' ? input.profile.retries : null,
        collectionTimeoutMilliseconds: input.profile.timeouts.collectionMilliseconds,
        cwd: input.command.cwd,
        definitionLocationCapture: input.definitionLocationCapture,
        engine: isolatedEngine(input.command),
        hardTimeoutMilliseconds: input.profile.timeouts.hardMilliseconds,
        hostProcess: input.profile.execution.processModel === 'worker-pool'
            ? input.profile.execution.hostProcess
            : { kind: 'direct' },
        maxConcurrency: input.profile.execution.maxConcurrency,
        paths: resolvedPaths(input.files),
        processBudgets: processUsagePolicy.budgets,
        processUsageSamplingIntervalMilliseconds: processUsagePolicy.samplingIntervalMilliseconds,
        ...runCollectionContext(input.source, input.command.cwd, input.profile),
        scheduling: input.profile.execution.scheduling,
        timeoutMilliseconds: input.profile.timeouts.softMilliseconds,
        workerLifecycle: input.profile.execution.processModel === 'worker-pool'
            ? input.profile.execution.workerLifecycle
            : 'reuse'
    };
}
