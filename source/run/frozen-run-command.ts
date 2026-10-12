import type { FrozenRunCommand, RunCommand } from './run-types.ts';
import { frozenPolicyCommand, parseFrozenMicrotestPolicy } from './frozen-run-policy.ts';
import { validateFrozenPolicySource } from './frozen-policy-validation.ts';
import type { RunInvocation, RunInputResolutionDependencies } from './run-input-resolution.ts';
import { configuredFilesRunCollectionSource, type CollectionSource } from './run-collection-source.ts';
import { invalidRequest } from './run-errors.ts';
import { validateRunInput } from './run-validation.ts';
import { withFileModuleBoundary } from './file-module-boundary.ts';

type PreparedRunCommand = { readonly command: RunCommand; readonly source: CollectionSource; };

function isFrozenRunCommand(command: FrozenRunCommand | RunCommand): command is FrozenRunCommand {
    return Reflect.get(command, 'kind') === 'frozen-policy';
}

export function snapshotRunCommand(command: FrozenRunCommand | RunCommand): PreparedRunCommand {
    if (!isFrozenRunCommand(command)) {
        return { command: { ...command }, source: configuredFilesRunCollectionSource };
    }
    const policy = parseFrozenMicrotestPolicy(command.policy);
    return {
        command: frozenPolicyCommand({ ...command, policy }),
        source: { kind: 'frozen-policy', policy }
    };
}

export async function withRunCommandModuleBoundary<Result>(
    command: FrozenRunCommand | RunCommand,
    operation: () => Promise<Result>
): Promise<Result> {
    const boundary = isFrozenRunCommand(command) ? parseFrozenMicrotestPolicy(command.policy).moduleBoundary : null;
    return await withFileModuleBoundary(boundary, operation);
}

export async function prepareRunCommand(
    command: FrozenRunCommand | RunCommand,
    namespace: RunInvocation['namespace'],
    dependencies: RunInputResolutionDependencies
): Promise<PreparedRunCommand> {
    if (!isFrozenRunCommand(command)) {
        return { command, source: configuredFilesRunCollectionSource };
    }
    if (namespace !== 'test') {
        invalidRequest('Frozen microtest policy cannot execute benchmarks.');
    }
    const policy = parseFrozenMicrotestPolicy(command.policy);
    const resolvedCommand = frozenPolicyCommand({ ...command, policy });
    validateRunInput(resolvedCommand);
    if (policy.profile.execution.processModel === 'in-process') {
        await validateFrozenPolicySource(policy, dependencies);
    }
    return {
        command: resolvedCommand,
        source: { kind: 'frozen-policy', policy }
    };
}
