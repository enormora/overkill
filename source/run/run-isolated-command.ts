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
    readonly engine: IsolatedCommandEngine;
    readonly hardTimeoutMilliseconds: number;
    readonly paths: readonly string[];
    readonly resourceBudgets: SupervisedRunCommand['resourceBudgets'];
    readonly resourceUsageSamplingIntervalMilliseconds: number;
    readonly scheduling: SupervisedRunCommand['scheduling'];
    readonly testFamily: SupervisedRunCommand['testFamily'];
    readonly timeoutMilliseconds: number;
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

function createSupervisedCommandBase(
    command: RunCommand,
    profile: RunProfileConfig,
    files: ResolvedRunInput['files'],
    capture: RunRequest['capture']
): SupervisedCommandBase {
    const resourceUsagePolicy = resolveResourceUsagePolicy(command.request, profile);

    return {
        capabilityRestrictions: supervisedCapabilityRestrictions(profile, command),
        capture,
        collectionTimeoutMilliseconds: profile.timeouts.collectionMilliseconds,
        cwd: command.cwd,
        engine: isolatedEngine(command),
        hardTimeoutMilliseconds: profile.timeouts.hardMilliseconds,
        paths: resolvedPaths(files),
        resourceBudgets: resourceUsagePolicy.budgets,
        resourceUsageSamplingIntervalMilliseconds: resourceUsagePolicy.samplingIntervalMilliseconds,
        scheduling: profile.execution.scheduling,
        testFamily: profile.testFamily,
        timeoutMilliseconds: profile.timeouts.softMilliseconds
    };
}

export function createSupervisedCollectCommand(
    command: RunCommand,
    profile: RunProfileConfig,
    files: ResolvedRunInput['files']
): SupervisedCollectCommand {
    return {
        ...createSupervisedCommandBase(command, profile, files, 'buffered'),
        kind: 'collect'
    };
}

export function createSupervisedRunCommand(
    command: RunCommand,
    profile: RunProfileConfig,
    files: ResolvedRunInput['files']
): SupervisedRunCommand {
    return {
        ...createSupervisedCommandBase(command, profile, files, command.request.capture),
        kind: 'run'
    };
}

export function createWorkerPoolCommand(
    command: RunCommand,
    profile: RunProfileConfig,
    files: ResolvedRunInput['files']
): WorkerPoolCommand {
    const resourceUsagePolicy = resolveResourceUsagePolicy(command.request, profile);

    return {
        collectionTimeoutMilliseconds: profile.timeouts.collectionMilliseconds,
        cwd: command.cwd,
        engine: isolatedEngine(command),
        hardTimeoutMilliseconds: profile.timeouts.hardMilliseconds,
        paths: resolvedPaths(files),
        resourceBudgets: resourceUsagePolicy.budgets,
        resourceUsageSamplingIntervalMilliseconds: resourceUsagePolicy.samplingIntervalMilliseconds,
        scheduling: profile.execution.scheduling,
        testFamily: profile.testFamily,
        timeoutMilliseconds: profile.timeouts.softMilliseconds
    };
}
