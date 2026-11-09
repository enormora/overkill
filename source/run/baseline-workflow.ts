import { createDefaultWorkId, workIdentityKey } from '../engine/identity.ts';
import { baselineIdentityKey } from '../baselines/baseline-planning.ts';
import type { RunResult, RunnerError } from '../engine/run-result.ts';
import type { BaselineWorkflowInput } from './baseline-types.ts';
import { snapshotEvidence } from './snapshot-evidence.ts';
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
    input: BaselineWorkflowInput,
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
    async function recordSnapshots(event: BaselineCaseEnd): Promise<void> {
        const evidence = await snapshotEvidence({
            artifacts: event.artifacts,
            profile: input.request.profile,
            work: event.workId ?? createDefaultWorkId(event.case),
            mode: input.request.baselineUpdateMode,
            existing,
            projectRoot: input.projectRoot
        });
        participating.push(...evidence.identities);
        changes.push(...evidence.changes);
    }
    async function evaluateAdapters(event: BaselineCaseEnd): Promise<CaseEvaluation> {
        const checks: EvaluatedBaseline['checks'][number][] = [];
        const errors: RunnerError[] = [];
        async function collectSnapshots(): Promise<void> {
            if (!input.policy.snapshots) {
                return;
            }
            try {
                await recordSnapshots(event);
            } catch (error: unknown) {
                errors.push(baselineRunnerError(error, event));
            }
        }
        async function collectAdapter(adapter: BaselineWorkflowInput['policy']['adapters'][number]): Promise<void> {
            try {
                checks.push(...record(
                    await evaluateBaselineAdapter({
                        adapter,
                        event,
                        profile: input.request.profile,
                        mode: input.request.baselineUpdateMode,
                        existing
                    })
                ));
            } catch (error: unknown) {
                errors.push(baselineRunnerError(error, event));
            }
        }
        await collectSnapshots();
        for (const adapter of input.policy.adapters) {
            await collectAdapter(adapter);
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
export async function createOrdinaryBaselineWorkflow(input: BaselineWorkflowInput): Promise<OrdinaryBaselineWorkflow> {
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
