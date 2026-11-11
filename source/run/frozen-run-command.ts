import type { FrozenRunCommand, RunCommand, RunCommandInput } from './run-types.ts';
import { commandWithDebug } from './run-debug.ts';
import { frozenPolicyCommand, parseFrozenMicrotestPolicy } from './frozen-run-policy.ts';
import { validateFrozenPolicySource } from './frozen-policy-validation.ts';
import type { RunInvocation, RunInputResolutionDependencies } from './run-input-resolution.ts';
import { selectedRunCollectionSource, type CollectionSource } from './run-collection-source.ts';
import { invalidRequest } from './run-errors.ts';
import { validateRunInput } from './run-validation.ts';
import { withFileModuleBoundary } from './file-module-boundary.ts';

type PreparedRunCommand = { readonly command: RunCommand; readonly source: CollectionSource; };

function isFrozenRunCommand(command: FrozenRunCommand | RunCommandInput): command is FrozenRunCommand {
    return Reflect.get(command, 'kind') === 'frozen-policy';
}

export function snapshotRunCommand(command: FrozenRunCommand | RunCommandInput): PreparedRunCommand {
    if (!isFrozenRunCommand(command)) {
        return { command: commandWithDebug(command), source: selectedRunCollectionSource() };
    }
    const policy = parseFrozenMicrotestPolicy(command.policy);
    return {
        command: frozenPolicyCommand({ ...command, policy }),
        source: { kind: 'frozen-policy', policy }
    };
}

export async function withRunCommandModuleBoundary<Result>(
    command: FrozenRunCommand | RunCommandInput,
    operation: () => Promise<Result>
): Promise<Result> {
    const boundary = isFrozenRunCommand(command) ? parseFrozenMicrotestPolicy(command.policy).moduleBoundary : null;
    return await withFileModuleBoundary(boundary, operation);
}

export async function prepareRunCommand(
    command: FrozenRunCommand | RunCommandInput,
    namespace: RunInvocation['namespace'],
    dependencies: RunInputResolutionDependencies
): Promise<PreparedRunCommand> {
    if (!isFrozenRunCommand(command)) {
        return { command: commandWithDebug(command), source: selectedRunCollectionSource() };
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
