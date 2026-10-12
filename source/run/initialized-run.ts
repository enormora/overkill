import { createCollectedRun } from './collected-run.ts';
import { withFileModuleBoundary } from './file-module-boundary.ts';
import { validateFrozenPolicySource } from './frozen-policy-validation.ts';
import { snapshotRunCommand } from './frozen-run-command.ts';
import { RunResolutionError } from './run-errors.ts';
import { readResolvedRunInput, type ResolvedRunInput } from './run-input-resolution.ts';
import { createLocalResolvedRun } from './run-local-resolution.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import { createRunRuntimePolicy, freezeValue, type RunRuntimePolicy } from './run-support.ts';
import type {
    CollectedRun,
    FrozenRunCommand,
    InitializedRun,
    RunCollectionSource,
    RunCommand,
    ResolvedRun
} from './run-types.ts';

type InitializedRunInput = {
    readonly command: RunCommand;
    readonly dependencies: RunOrchestratorDependencies;
    readonly input: ResolvedRunInput;
    readonly source: RunCollectionSource;
};

function completeCollection(resolved: ResolvedRun, runtimePolicy: RunRuntimePolicy): ResolvedRun {
    const errors = runtimePolicy.takeRunErrors();
    if (errors.length > 0) {
        throw new AggregateError(errors, 'Test collection violated runtime policy.', { cause: errors[0] });
    }
    return resolved;
}

async function collectRunWithPolicy(context: InitializedRunInput): Promise<ResolvedRun> {
    const { command, dependencies, input, source } = context;
    const runtimePolicy = createRunRuntimePolicy(command.request, dependencies);
    try {
        const resolved = await runtimePolicy.runLoad(async function collectObservedRun() {
            return await createLocalResolvedRun(command, dependencies, input, source);
        });
        return completeCollection(resolved, runtimePolicy);
    } catch (error: unknown) {
        const errors = runtimePolicy.takeRunErrors();
        if (errors.length > 0) {
            throw new AggregateError([ error, ...errors ], 'Test collection failed.', { cause: error });
        }
        throw error;
    }
}

async function collectRun(context: InitializedRunInput): Promise<CollectedRun> {
    const { command, dependencies, input, source } = context;
    const moduleBoundary = source.kind === 'frozen-policy' ? source.policy.moduleBoundary : null;
    return await withFileModuleBoundary(moduleBoundary, async function collectBoundedRun() {
        if (source.kind === 'frozen-policy') {
            await validateFrozenPolicySource(source.policy, dependencies);
        }
        const resolved = await collectRunWithPolicy(context);
        if (resolved.plan.kind !== 'local' && resolved.plan.kind !== 'empty-shard') {
            throw new RunResolutionError(
                'Collected execution requires an in-process plan.',
                undefined,
                'unsupported-request'
            );
        }
        return createCollectedRun({
            command,
            dependencies,
            input,
            moduleBoundary,
            resolved: { ...resolved, plan: resolved.plan }
        });
    });
}

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
