import { createDefaultWorkId, workIdentityKey } from '../engine/identity.ts';
import type { RunResult, RunnerError } from '../engine/run-result.ts';
import { baselineIdentityKey } from '../baselines/baseline-planning.ts';
import type { OrdinaryBaselinePolicy } from '../baselines/baseline-policy.ts';
import {
    baselineRunnerError,
    withBaselineChecks,
    withBaselineVerdicts,
    type BaselineCaseEnd
} from './baseline-outcomes.ts';
import { createOrdinaryBaselineStore, type OrdinaryBaselineStore } from './baseline-store.ts';
import {
    baselineFilename,
    ordinaryBaselineIdentity,
    type OrdinaryBaselineChange,
    type StoredOrdinaryBaseline
} from './baseline-record.ts';
import { evaluateBaselineAdapter, type OrdinaryAdapterEvaluation } from './baseline-evaluation.ts';
import { belongsToBaselineScope, reconcileBaselineInventory } from './baseline-inventory.ts';
import type { RunRequest } from './run-types.ts';

type WorkflowInput = {
    readonly policy: OrdinaryBaselinePolicy;
    readonly projectRoot: string;
    readonly request: RunRequest;
    readonly maxBytes: number;
};
type CaseEvaluation = { readonly errors: readonly RunnerError[]; readonly event: BaselineCaseEnd; };
type EvaluatedBaseline = Extract<OrdinaryAdapterEvaluation, { readonly kind: 'evaluated'; }>;
type EvaluationState = {
    readonly changes: readonly OrdinaryBaselineChange[];
    readonly participating: readonly EvaluatedBaseline['identity'][];
    readonly prepareResult: (result: RunResult) => RunResult;
    readonly evaluate: (event: BaselineCaseEnd) => Promise<CaseEvaluation>;
};
export type OrdinaryBaselineWorkflow = {
    readonly changes: readonly OrdinaryBaselineChange[];
    readonly warnings: readonly string[];
    readonly store: OrdinaryBaselineStore;
    readonly prepareResult: (result: RunResult) => RunResult;
    readonly finish: (result: RunResult) => RunResult;
    readonly evaluate: (event: BaselineCaseEnd) => Promise<CaseEvaluation>;
};
function createEvaluationState(
    input: WorkflowInput,
    existing: ReadonlyMap<string, StoredOrdinaryBaseline>
): EvaluationState {
    const changes: OrdinaryBaselineChange[] = [];
    const events = new Map<string, BaselineCaseEnd>();
    const pending = new Map<string, Promise<CaseEvaluation>>();
    const participating: EvaluatedBaseline['identity'][] = [];
    function record(evaluated: OrdinaryAdapterEvaluation): EvaluatedBaseline['checks'] {
        if (evaluated.kind !== 'evaluated') {
            return [];
        }
        participating.push(evaluated.identity);
        if (evaluated.change !== null) {
            changes.push(evaluated.change);
        }
        return evaluated.checks;
    }
    async function evaluateAdapters(event: BaselineCaseEnd): Promise<CaseEvaluation> {
        const checks: EvaluatedBaseline['checks'][number][] = [];
        const errors: RunnerError[] = [];
        for (const adapter of input.policy.adapters) {
            try {
                const evaluated = await evaluateBaselineAdapter({
                    adapter,
                    event,
                    profile: input.request.profile,
                    mode: input.request.baselineUpdateMode,
                    existing
                });
                checks.push(...record(evaluated));
            } catch (error: unknown) {
                errors.push(baselineRunnerError(error, event));
            }
        }
        const evaluated = withBaselineChecks(event, checks);
        events.set(workIdentityKey(event.workId ?? createDefaultWorkId(event.case)), evaluated);
        return { errors, event: evaluated };
    }
    return {
        changes,
        participating,
        prepareResult(result) {
            return withBaselineVerdicts(result, events);
        },
        async evaluate(event) {
            if (event.completion !== 'final' || event.verdict !== 'pass') {
                return { errors: [], event };
            }
            const key = workIdentityKey(event.workId ?? createDefaultWorkId(event.case));
            const evaluation = pending.get(key) ?? evaluateAdapters(event);
            pending.set(key, evaluation);
            return await evaluation;
        }
    };
}
export async function createOrdinaryBaselineWorkflow(input: WorkflowInput): Promise<OrdinaryBaselineWorkflow> {
    const store = await createOrdinaryBaselineStore({
        directory: input.policy.directory,
        projectRoot: input.projectRoot,
        maxBytes: input.maxBytes
    });
    const entries = await store.list();
    const existing = new Map(
        entries
            .filter(function selected(entry) {
                return belongsToBaselineScope(input.policy, input.request.profile, entry.baseline);
            })
            .map(function keyed(entry) {
                return [ baselineIdentityKey(ordinaryBaselineIdentity(entry.baseline)), entry.baseline ];
            })
    );
    const evaluation = createEvaluationState(input, existing);
    const changes: OrdinaryBaselineChange[] = [];
    const warnings: string[] = [];
    let inventoryReconciled = false;
    function finish(result: RunResult): RunResult {
        if (inventoryReconciled) {
            return result;
        }
        inventoryReconciled = true;
        const completion = reconcileBaselineInventory({
            policy: input.policy,
            request: input.request,
            result,
            existing: Array.from(existing.values()),
            participating: evaluation.participating
        });
        const proposed = [ ...evaluation.changes, ...completion.changes ].toSorted(
            function publicationOrder(left, right) {
                return baselineFilename(left.baseline).localeCompare(baselineFilename(right.baseline));
            }
        );
        changes.push(...proposed);
        warnings.push(...completion.warnings);
        return completion.result;
    }
    return {
        changes,
        store,
        warnings,
        finish,
        evaluate: evaluation.evaluate,
        prepareResult(result) {
            return finish(evaluation.prepareResult(result));
        }
    };
}
