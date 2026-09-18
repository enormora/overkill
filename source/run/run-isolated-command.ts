import type { DefinitionLocationCapture } from './definition-location-capture.ts';
import { resolveResourceUsagePolicy } from './run-facts.ts';
import type { ResolvedRunInput } from './run-input-resolution.ts';
import type {
    RunCommand,
    RunProfileConfig,
    RunRequest
} from './run-types.ts';
import type {
    SupervisedCollectCommand,
    SupervisedRunCommand
} from './supervised-protocol.ts';
import type { WorkerPoolCommand } from './worker-pool-protocol.ts';

type IsolatedCommandEngine = Exclude<RunCommand['engine'], { readonly kind: 'instance'; }>;

type SupervisedCommandBase = {
    readonly capabilityRestrictions: SupervisedRunCommand['capabilityRestrictions'];
    readonly capture: SupervisedRunCommand['capture'];
    readonly collectionTimeoutMilliseconds: number;
    readonly cwd: string;
    readonly definitionLocationCapture: SupervisedRunCommand['definitionLocationCapture'];
    readonly engine: IsolatedCommandEngine;
    readonly hardTimeoutMilliseconds: number;
    readonly paths: readonly string[];
    readonly resourceBudgets: SupervisedRunCommand['resourceBudgets'];
    readonly resourceUsageSamplingIntervalMilliseconds: number;
    readonly scheduling: SupervisedRunCommand['scheduling'];
    readonly testFamily: SupervisedRunCommand['testFamily'];
    readonly timeoutMilliseconds: number;
};

type SupervisedCommandBaseInput = {
    readonly capture: RunRequest['capture'];
    readonly command: RunCommand;
    readonly definitionLocationCapture: DefinitionLocationCapture;
    readonly files: ResolvedRunInput['files'];
    readonly profile: RunProfileConfig;
};

function isolatedEngine(command: RunCommand): IsolatedCommandEngine {
    if (command.engine.kind === 'instance') {
        throw new Error('Instance engines cannot run in supervised children.');
    }

    return command.engine;
}

function supervisedCapabilityRestrictions(
    profile: RunProfileConfig,
    command: RunCommand
): SupervisedCommandBase['capabilityRestrictions'] {
    if (profile.testFamily === 'integration') {
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
    const resourceUsagePolicy = resolveResourceUsagePolicy(input.command.request, input.profile);

    return {
        capabilityRestrictions: supervisedCapabilityRestrictions(input.profile, input.command),
        capture: input.capture,
        collectionTimeoutMilliseconds: input.profile.timeouts.collectionMilliseconds,
        cwd: input.command.cwd,
        definitionLocationCapture: input.definitionLocationCapture,
        engine: isolatedEngine(input.command),
        hardTimeoutMilliseconds: input.profile.timeouts.hardMilliseconds,
        paths: resolvedPaths(input.files),
        resourceBudgets: resourceUsagePolicy.budgets,
        resourceUsageSamplingIntervalMilliseconds: resourceUsagePolicy.samplingIntervalMilliseconds,
        scheduling: input.profile.execution.scheduling,
        testFamily: input.profile.testFamily,
        timeoutMilliseconds: input.profile.timeouts.softMilliseconds
    };
}

export function createSupervisedCollectCommand(
    command: RunCommand,
    profile: RunProfileConfig,
    files: ResolvedRunInput['files']
): SupervisedCollectCommand {
    return {
        ...createSupervisedCommandBase({
            capture: 'buffered',
            command,
            definitionLocationCapture: 'enabled',
            files,
            profile
        }),
        kind: 'collect'
    };
}

export function createSupervisedRunCommand(
    command: RunCommand,
    profile: RunProfileConfig,
    files: ResolvedRunInput['files']
): SupervisedRunCommand {
    return {
        ...createSupervisedCommandBase({
            capture: command.request.capture,
            command,
            definitionLocationCapture: 'disabled',
            files,
            profile
        }),
        kind: 'run'
    };
}

export function createWorkerPoolCommand(
    command: RunCommand,
    definitionLocationCapture: DefinitionLocationCapture,
    profile: RunProfileConfig,
    files: ResolvedRunInput['files']
): WorkerPoolCommand {
    const resourceUsagePolicy = resolveResourceUsagePolicy(command.request, profile);

    return {
        collectionTimeoutMilliseconds: profile.timeouts.collectionMilliseconds,
        cwd: command.cwd,
        definitionLocationCapture,
        engine: isolatedEngine(command),
        hardTimeoutMilliseconds: profile.timeouts.hardMilliseconds,
        hostProcess: profile.execution.processModel === 'worker-pool'
            ? profile.execution.hostProcess
            : { kind: 'direct' },
        paths: resolvedPaths(files),
        resourceBudgets: resourceUsagePolicy.budgets,
        resourceUsageSamplingIntervalMilliseconds: resourceUsagePolicy.samplingIntervalMilliseconds,
        scheduling: profile.execution.scheduling,
        testFamily: profile.testFamily,
        timeoutMilliseconds: profile.timeouts.softMilliseconds,
        workerLifecycle: profile.execution.processModel === 'worker-pool'
            ? profile.execution.workerLifecycle
            : 'reuse'
    };
}
