import { currentExecutionSession } from './execution-session-context.ts';
import { assertDirectEntrypointCollectionMatches } from './direct-entrypoint-collection.ts';
import { createLocalTestPlan, type LocalTestPlan } from './run-local-test-plan.ts';
import { resolveProcessUsagePolicy, resolveRunScheduling } from './run-profile-facts.ts';
import type { ResolvedRunInput } from './run-input-resolution.ts';
import type { RunCommand, CollectedRunPlan, RunRequest } from './run-types.ts';
import type {
    SupervisedCollectCommand,
    SupervisedExecutionMode,
    SupervisedRunCommand
} from './supervised-protocol.ts';
import type { WorkerPoolCommand } from './worker-pool-protocol.ts';
import { runCollectionRoot, type CollectionSource } from './run-collection-source.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';

export type IsolatedRunCollectionSource = CollectionSource;

type IsolatedCommandEngine = Exclude<RunCommand['engine'], { readonly kind: 'instance'; }>;

type SupervisedCommandBase = {
    readonly propertyPolicy: SupervisedRunCommand['propertyPolicy'];
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
    readonly testFamily: SupervisedRunCommand['testFamily'];
    readonly timeoutMilliseconds: number;
};

type SupervisedCommandBaseInput = {
    readonly capture: RunRequest['capture'];
    readonly command: RunCommand;
    readonly definitionLocationCapture: SupervisedRunCommand['definitionLocationCapture'];
    readonly files: ResolvedRunInput['files'];
    readonly profile: ResolvedRunInput['profile'];
    readonly source: IsolatedRunCollectionSource;
};

type WorkerPoolCommandInput = {
    readonly command: RunCommand;
    readonly definitionLocationCapture: SupervisedRunCommand['definitionLocationCapture'];
    readonly files: ResolvedRunInput['files'];
    readonly profile: ResolvedRunInput['profile'];
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
    input: ResolvedRunInput,
    source: IsolatedRunCollectionSource
): Promise<LocalTestPlan | null> {
    return source.kind === 'direct-entrypoint'
        ? await createLocalTestPlan({
            command,
            definitionLocationCapture: 'enabled',
            dependencies,
            files: input.files,
            profile: input.profile,
            source
        })
        : null;
}

export function assertExpectedDirectEntrypointCollection(
    expected: LocalTestPlan | null,
    actual: CollectedRunPlan
): void {
    if (expected !== null) {
        assertDirectEntrypointCollectionMatches(expected, actual);
    }
}

function supervisedCapabilityRestrictions(
    profile: ResolvedRunInput['profile'],
    command: RunCommand
): SupervisedCommandBase['capabilityRestrictions'] {
    if (profile.testFamily !== 'microtest' && profile.testFamily !== 'property') {
        return { mode: 'disabled' };
    }

    return command.request.capabilityRestrictions;
}

function resolvedPaths(files: ResolvedRunInput['files']): readonly string[] {
    return files.map(function toFilePath(file) {
        return file.file;
    });
}

function createSupervisedCommandBase(input: SupervisedCommandBaseInput): SupervisedCommandBase {
    const processUsagePolicy = resolveProcessUsagePolicy(input.command.request, input.profile);

    return {
        propertyPolicy: input.profile.testFamily === 'property' ? input.profile.property : null,
        capabilityRestrictions: supervisedCapabilityRestrictions(input.profile, input.command),
        capture: input.capture,
        collectionTimeoutMilliseconds: input.profile.timeouts.collectionMilliseconds,
        cwd: input.command.cwd,
        definitionLocationCapture: input.definitionLocationCapture,
        engine: isolatedEngine(input.command),
        hardTimeoutMilliseconds: input.profile.timeouts.hardMilliseconds,
        maxConcurrency: input.profile.execution.maxConcurrency,
        paths: resolvedPaths(input.files),
        processBudgets: processUsagePolicy.budgets,
        processUsageSamplingIntervalMilliseconds: processUsagePolicy.samplingIntervalMilliseconds,
        root: runCollectionRoot(input.source, input.command.cwd),
        scheduling: resolveRunScheduling(input.command.request, input.profile),
        testFamily: input.profile.testFamily,
        retryPolicy: input.profile.testFamily === 'integration' ? input.profile.retries : null,
        timeoutMilliseconds: input.profile.timeouts.softMilliseconds
    };
}

export function createSupervisedCollectCommand(
    command: RunCommand,
    profile: ResolvedRunInput['profile'],
    files: ResolvedRunInput['files'],
    source: IsolatedRunCollectionSource
): SupervisedCollectCommand {
    return {
        ...createSupervisedCommandBase({
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
    profile: ResolvedRunInput['profile'],
    files: ResolvedRunInput['files'],
    source: IsolatedRunCollectionSource
): SupervisedRunCommand {
    return {
        ...createSupervisedCommandBase({
            capture: command.request.capture,
            command,
            definitionLocationCapture: source.kind === 'direct-entrypoint' ? 'enabled' : 'disabled',
            files,
            profile,
            source
        }),
        ...supervisedExecutionMode(source)
    };
}

export function createWorkerPoolCommand(
    input: WorkerPoolCommandInput
): WorkerPoolCommand {
    const processUsagePolicy = resolveProcessUsagePolicy(input.command.request, input.profile);

    return {
        attachmentEndpoint: null,
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
        root: runCollectionRoot(input.source, input.command.cwd),
        scheduling: input.profile.execution.scheduling,
        testFamily: input.profile.testFamily,
        timeoutMilliseconds: input.profile.timeouts.softMilliseconds,
        workerLifecycle: input.profile.execution.processModel === 'worker-pool'
            ? input.profile.execution.workerLifecycle
            : 'reuse'
    };
}
