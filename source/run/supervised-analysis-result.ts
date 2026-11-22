import { workIdentityKey } from '../engine/identity.ts';
import { appendRunnerErrors } from '../engine/execution-result.ts';
import { singleAttemptResult, type RunResult } from '../engine/run-result.ts';
import { collectedRunCaseEntries } from './collected-run-plan.ts';
import type { CollectedRunPlan } from './run-types.ts';
import type { SupervisedRunState } from './supervised-run-state.ts';
import { reportTerminalCases } from './run-result-reporting.ts';
import type { ReporterDelivery } from './run-engine-primitives.ts';

export function completeAnalysisResults(
    plan: CollectedRunPlan,
    completed: RunResult['perTest']
): RunResult['perTest'] {
    const results = new Map(completed.map(function byWork(result) {
        return [ workIdentityKey(result.workId), result ];
    }));
    return collectedRunCaseEntries(plan).map(function completeCase(entry) {
        const result = results.get(workIdentityKey(entry.workId));
        if (result !== undefined && result.verdict !== 'crashed') {
            return result;
        }
        const { skipReason, definitionLocations } = entry.testCase;
        return singleAttemptResult({
            id: entry.workId.case,
            workId: entry.workId,
            definitionLocations,
            outcome: skipReason === null
                ? { kind: 'inconclusive', reason: 'Analysis ended without complete evidence.' }
                : { kind: 'skip', reason: skipReason },
            verdict: skipReason === null ? 'inconclusive' : 'skip',
            durationMicroseconds: 0
        }, { index: 0 });
    });
}

export async function reportInterruptedAnalysis(
    result: RunResult,
    plan: CollectedRunPlan,
    state: Pick<SupervisedRunState, 'perTestResults' | 'terminalCases'>,
    delivery: Pick<ReporterDelivery, 'reportEvent'>
): Promise<RunResult> {
    const cases = collectedRunCaseEntries(plan);
    const observed = new Set(
        state.perTestResults().map(function observedWork(entry) {
            return workIdentityKey(entry.workId);
        })
    );
    const missing = result.perTest.filter(function needsStart(entry) {
        return !observed.has(workIdentityKey(entry.workId));
    });
    const errors: RunResult['runnerErrors'][number][] = [];
    for (const completion of missing) {
        const planned = cases.find(function matchingCase(entry) {
            return workIdentityKey(entry.workId) === workIdentityKey(completion.workId);
        });
        errors.push(
            ...await delivery.reportEvent({
                kind: 'test-start',
                attempt: 0,
                case: completion.id,
                workId: completion.workId,
                definitionLocations: completion.definitionLocations,
                suitePath: planned?.testCase.suitePath ?? []
            })
        );
    }
    return await reportTerminalCases(
        appendRunnerErrors(result, errors),
        [ ...state.terminalCases(), ...missing ],
        plan,
        delivery
    );
}
