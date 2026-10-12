import {
    createEmptySelectionResult,
    createEmptyShardResolvedRunFromTestPlan,
    createLocalResolvedRunFromTestPlan
} from './run-local-planning.ts';
import { selectedNonEmptyTestPlanCases } from './run-selection.ts';
import { intersectSelection } from './frozen-run-policy.ts';
import { copyRunSelection, invalidRunSelectionMessage } from './run-selection-filters.ts';
import { invalidRequest } from './run-errors.ts';
import { freezeValue } from './run-support.ts';
import type {
    CollectedRunInvocation,
    FileModuleBoundary,
    ResolvedRun,
    ResolvedRunPlan,
    RunCommand,
    RunRequest
} from './run-types.ts';
import type { RunResult } from './run-engine-primitives.ts';
import type { ResolvedRunInput } from './run-input-resolution.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';

type ReusableResolvedRun = ResolvedRun & {
    readonly plan: Extract<ResolvedRunPlan, { readonly kind: 'empty-shard' | 'local'; }>;
};

export type CollectedRunContext = {
    readonly command: RunCommand;
    readonly dependencies: RunOrchestratorDependencies;
    readonly input: ResolvedRunInput;
    readonly moduleBoundary: FileModuleBoundary | null;
    readonly resolved: ReusableResolvedRun;
};

export type CollectedInvocationPlan = {
    readonly kind: 'empty-selection';
    readonly resolved: ResolvedRun;
    readonly result: RunResult;
} | {
    readonly kind: 'planned';
    readonly resolved: ResolvedRun;
};

function collectedInvocationRequest(resolved: ResolvedRun, invocation: CollectedRunInvocation): RunRequest {
    const message = invalidRunSelectionMessage(invocation.selection);
    if (message !== null) {
        invalidRequest(message);
    }
    const selection = intersectSelection(resolved.request.selection, copyRunSelection(invocation.selection));
    return freezeValue({ ...resolved.request, selection });
}

export function planCollectedInvocation(
    context: CollectedRunContext,
    invocation: CollectedRunInvocation
): CollectedInvocationPlan {
    const { command, dependencies, input, resolved } = context;
    const request = collectedInvocationRequest(resolved, invocation);
    if (resolved.plan.kind === 'empty-shard') {
        return {
            kind: 'planned',
            resolved: freezeValue({
                ...resolved,
                facts: {
                    ...resolved.facts,
                    reproducibility: { ...resolved.facts.reproducibility, selection: request.selection }
                },
                request
            })
        };
    }
    const { testPlan } = resolved.plan;
    const cases = selectedNonEmptyTestPlanCases({ ...testPlan, discoveredCases: testPlan.cases }, request.selection);
    const runInput = { ...input, request };
    if (cases === null) {
        return {
            kind: 'empty-selection',
            resolved: createEmptyShardResolvedRunFromTestPlan(
                { ...command, request },
                dependencies,
                runInput,
                testPlan
            ),
            result: createEmptySelectionResult(testPlan, dependencies)
        };
    }
    return {
        kind: 'planned',
        resolved: createLocalResolvedRunFromTestPlan({ ...command, request }, dependencies, runInput, {
            ...testPlan,
            cases
        })
    };
}
