import { validateProcessUsagePolicy } from '../config/validation.ts';
import type { TestPlan } from '../engine/test-plan.ts';
import { finalizeRunResult } from './run-result-finalization.ts';
import type { LocalRunOptions } from './local-run-collection.ts';
import type { RunRuntimePolicy } from './run-support.ts';
import {
    executeEmptyShardRun
} from './run-empty-shard.ts';
import {
    executeLocalResolvedRun
} from './run-local-execution.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import type { ResolvedRun } from './run-types.ts';

import type { LocalExecutionOptions } from './family-profile-execution.ts';

type RunResult = Awaited<ReturnType<RunOrchestratorDependencies['execute']>>;
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
    validateProcessUsagePolicy(resolvedRun.facts.execution.processUsagePolicy);

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

export async function executeLocalRun(
    resolvedRun: ResolvedRun,
    dependencies: RunOrchestratorDependencies,
    runtimePolicy: RunRuntimePolicy | null,
    options: LocalRunOptions
): Promise<RunResult> {
    return await executeInProcessResolvedRun(resolvedRun, dependencies, {
        async finalizeResult(run, result) {
            return await finalizeRunResult(run, result, { ...options, dependencies, coverageSession: null });
        },
        runtimePolicy,
        timing: options.timing
    });
}
