import { collectRun } from './initialized-run-collection.ts';
import { snapshotRunCommand } from './frozen-run-command.ts';
import { RunResolutionError } from './run-errors.ts';
import { readResolvedRunInput } from './run-input-resolution.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import { freezeValue } from './run-support.ts';
import type { CollectedRun, FrozenRunCommand, InitializedRun, RunCommand } from './run-types.ts';

export async function initializeRun(
    suppliedCommand: FrozenRunCommand | RunCommand,
    dependencies: RunOrchestratorDependencies
): Promise<InitializedRun> {
    const snapshot = snapshotRunCommand(suppliedCommand);
    const command = { ...snapshot.command };
    const input = await readResolvedRunInput({ command, namespace: 'test' }, dependencies, snapshot.source);
    if (input.profile.execution.processModel !== 'in-process') {
        throw new RunResolutionError(
            'Collected execution requires an in-process profile.',
            undefined,
            'unsupported-request'
        );
    }
    const request = { ...input.request, seed: { value: input.request.seed.value ?? dependencies.createSeed() } };
    const context = {
        command: freezeValue({ ...command, config: input.config, engine: input.engine, request }),
        dependencies,
        input: freezeValue({ ...input, request }),
        source: snapshot.source
    };
    let collection: Promise<CollectedRun> | null = null;
    return Object.freeze({
        async collect() {
            collection = collection ?? collectRun(context);
            return collection;
        }
    });
}
