import { isFamilyPlan, recollectProfileFamily, resolveFamilyRun } from './family-profile-run.ts';
import { parseRunSelection } from './run-selection-schema.ts';
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
        return invalidRequest(error instanceof Error ? error.message : String(error));
    }
}

function collectedInvocationRequest(resolved: ResolvedRun, invocation: CollectedRunInvocation): RunRequest {
    const selection = intersectSelection(resolved.request.selection, validatedInvocationSelection(invocation));
    return freezeValue({ ...resolved.request, selection });
}

async function planSelectedInvocation(
    context: CollectedRunContext,
    request: RunRequest,
    runInput: ResolvedRunInput,
    plan: Extract<ResolvedRunPlan, { readonly kind: 'local'; }>
): Promise<CollectedInvocationPlan> {
    const { command, dependencies } = context;
    const { testPlan } = plan;
    const cases = selectedNonEmptyTestPlanCases({ ...testPlan, discoveredCases: testPlan.cases }, request.selection);
    if (cases === null) {
        const resolved = createEmptyShardResolvedRunFromTestPlan(
            { ...command, request },
            dependencies,
            runInput,
            { plan: testPlan, identities: [] }
        );
        return {
            kind: 'empty-selection',
            resolved: isFamilyPlan(plan)
                ? await resolveFamilyRun(plan.family.preparation, async function emptyFamilySelection() {
                    return resolved;
                })
                : resolved,
            result: createEmptySelectionResult(testPlan, dependencies)
        };
    }
    if (isFamilyPlan(plan)) {
        return {
            kind: 'planned',
            resolved: await recollectProfileFamily(
                plan.family.preparation,
                { ...testPlan, cases },
                function resolveInvocation(preparedPlan) {
                    return createLocalResolvedRunFromTestPlan(
                        { ...command, request },
                        dependencies,
                        runInput,
                        preparedPlan
                    );
                }
            )
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

export async function planCollectedInvocation(
    context: CollectedRunContext,
    invocation: CollectedRunInvocation
): Promise<CollectedInvocationPlan> {
    const { input, resolved } = context;
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
    return await planSelectedInvocation(context, request, { ...input, request }, resolved.plan);
}
