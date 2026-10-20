import {
    createExecutionGlobalErrorObserver,
    type ExecutionGlobalErrorObserver
} from '../engine/execution-global-error-observer.ts';
import { createCollectedRun } from './collected-run.ts';
import { withFileModuleBoundary } from './file-module-boundary.ts';
import { validateFrozenPolicySource } from './frozen-policy-validation.ts';
import { RunResolutionError } from './run-errors.ts';
import type { ResolvedRunInput } from './run-input-resolution.ts';
import { createLocalResolvedRun } from './run-local-resolution.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import { observeRunRuntimePolicy, type RunRuntimePolicy } from './run-support.ts';
import type { CollectedRun, RunCollectionSource, RunCommand, ResolvedRun } from './run-types.ts';

export type InitializedRunInput = {
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

async function collectionHookFailure(observer: ExecutionGlobalErrorObserver): Promise<never> {
    await observer.fatalSignal();
    const errors = observer.takeErrors();
    throw new AggregateError(
        errors,
        errors[0]?.message ?? 'Test collection failed after a process-level runtime error.',
        {
            cause: errors[0] ?? null
        }
    );
}

async function observeCollectedPlan(collect: () => Promise<ResolvedRun>): Promise<ResolvedRun> {
    const observer = createExecutionGlobalErrorObserver('in-process');
    try {
        return await observer.runBoundary(async function observeCollectionBoundary() {
            return await observer.runPhase('collection', async function observeCollectionErrors() {
                const failure = collectionHookFailure(observer);
                const resolved = await Promise.race([ collect(), failure ]);
                if (observer.hasFatalError()) {
                    await failure;
                }
                return resolved;
            });
        });
    } finally {
        observer.stop();
    }
}

async function collectRunWithPolicy(context: InitializedRunInput): Promise<ResolvedRun> {
    const { command, dependencies, input, source } = context;
    return await observeRunRuntimePolicy(
        command.request,
        dependencies,
        async function observeCollectionPolicy(runtimePolicy) {
            try {
                const resolved = await observeCollectedPlan(async function collectObservedPlan() {
                    return await runtimePolicy.runLoad(async function collectObservedRun() {
                        if (source.kind === 'frozen-policy') {
                            await validateFrozenPolicySource(source.policy, dependencies);
                        }
                        return await createLocalResolvedRun(command, dependencies, input, source);
                    });
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
    );
}

export async function collectRun(context: InitializedRunInput): Promise<CollectedRun> {
    const { command, dependencies, input, source } = context;
    const moduleBoundary = source.kind === 'frozen-policy' ? source.policy.moduleBoundary : null;
    return await withFileModuleBoundary(moduleBoundary, async function collectBoundedRun() {
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
