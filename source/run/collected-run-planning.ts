import { parseRunSelection } from './run-selection-schema.ts';
import { collectAdapterResolvedRun, isAdapterPlan } from './adapter-execution.ts';
import {
    createEmptySelectionResult,
    createEmptyShardResolvedRunFromTestPlan,
    createLocalResolvedRunFromTestPlan
} from './run-local-planning.ts';
import { selectedNonEmptyTestPlanCases } from './run-selection.ts';
import { intersectSelection } from './frozen-run-policy.ts';
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
import type { ResolvedRunInput } from './run-input-resolution.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';

type RunResult = Awaited<ReturnType<RunOrchestratorDependencies['execute']>>;

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

function validatedInvocationSelection(invocation: CollectedRunInvocation): RunRequest['selection'] {
    try {
        return parseRunSelection(invocation.selection);
    } catch (error: unknown) {
        invalidRequest(error instanceof Error ? error.message : String(error));
    }
}

function collectedInvocationRequest(resolved: ResolvedRun, invocation: CollectedRunInvocation): RunRequest {
    const selection = intersectSelection(resolved.request.selection, validatedInvocationSelection(invocation));
    return freezeValue({ ...resolved.request, selection });
}

export async function planCollectedInvocation(
    context: CollectedRunContext,
    invocation: CollectedRunInvocation
): Promise<CollectedInvocationPlan> {
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
        resolved: await collectAdapterResolvedRun(
            isAdapterPlan(resolved.plan) ? resolved.plan.adapter.preparation : null,
            createLocalResolvedRunFromTestPlan({ ...command, request }, dependencies, runInput, { ...testPlan, cases })
        )
    };
}
