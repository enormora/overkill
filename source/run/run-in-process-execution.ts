import { validateResourceUsagePolicy } from '../config/validation.ts';
import type { TestPlan } from '../engine/test-plan.ts';
import {
    executeEmptyShardRun
} from './run-empty-shard.ts';
import {
    executeLocalResolvedRun,
    type LocalExecutionOptions
} from './run-local-execution.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import type {
    ResolvedRun,
    RunOrchestrator
} from './run-types.ts';

type RunResult = Awaited<ReturnType<RunOrchestrator['run']>>;
type LocalResolvedRun = ResolvedRun & {
    readonly plan: {
        readonly kind: 'local';
        readonly testPlan: TestPlan;
    };
};

function isLocalResolvedRun(resolvedRun: ResolvedRun): resolvedRun is LocalResolvedRun {
    return resolvedRun.plan.kind === 'local';
}

export async function executeInProcessResolvedRun(
    resolvedRun: ResolvedRun,
    dependencies: RunOrchestratorDependencies,
    options: LocalExecutionOptions
): Promise<RunResult> {
    validateResourceUsagePolicy(resolvedRun.facts.execution.resourceUsagePolicy);

    if (resolvedRun.plan.kind === 'empty-shard') {
        return await executeEmptyShardRun(
            resolvedRun,
            dependencies,
            options.finalizeResult,
            options.runtimePolicy
        );
    }

    if (!isLocalResolvedRun(resolvedRun)) {
        throw new Error('In-process execution requires a local test plan.');
    }

    return await executeLocalResolvedRun(resolvedRun, dependencies, options);
}
