import type { NonEmptyReadonlyArray } from '../assertion-protocol/assertion-node-shape.ts';
import { runStatusFromPlan } from '../engine/run-result.ts';
import type { RunRecordResult } from './run-record-types.ts';
import type { MergeSource } from './merge-results-input.ts';
import { mergedRunTimings } from './merged-run-timings.ts';

type Results = NonEmptyReadonlyArray<RunRecordResult>;
function mergedSummary(results: Results): RunRecordResult['summary'] {
    const summary = { ...results[0].summary };
    const localCounts = [
        'planned',
        'crashed',
        'failed',
        'inconclusive',
        'passed',
        'processExhausted',
        'runtimePolicy',
        'skipped'
    ] as const;
    for (const key of localCounts) {
        summary[key] = results.reduce(function sum(total, result) {
            return total + result.summary[key];
        }, 0);
    }
    return summary;
}
function mergedSuites(results: Results): RunRecordResult['bySuite'] {
    const suites = new Map<string, RunRecordResult['bySuite'][string]>();
    for (const result of results) {
        for (const [ title, counts ] of Object.entries(result.bySuite)) {
            const previous = suites.get(title) ?? { discovered: counts.discovered, executed: 0, planned: 0 };
            suites.set(title, {
                discovered: previous.discovered,
                executed: previous.executed + counts.executed,
                planned: previous.planned + counts.planned
            });
        }
    }
    return Object.fromEntries(suites);
}
function mergedPlanStatus(results: Results): RunRecordResult['planStatus'] {
    if (
        results.some(function planned(result) {
            return result.planStatus === 'planned';
        })
    ) {
        return 'planned';
    }
    if (
        results.some(function empty(result) {
            return result.planStatus === 'empty-selection';
        })
    ) {
        return 'empty-selection';
    }
    return 'empty-shard';
}
function mergeOutcomes(results: Results): Pick<RunRecordResult, 'planStatus' | 'runnerErrors' | 'status' | 'summary'> {
    const summary = mergedSummary(results);
    const runnerErrors = results.flatMap(function errors(result) {
        return result.runnerErrors;
    });
    const planStatus = mergedPlanStatus(results);
    const failed = results.some(function failedShard(result) {
        return result.status === 'failed';
    });
    return {
        summary,
        runnerErrors,
        planStatus,
        status: failed ? 'failed' : runStatusFromPlan(summary, runnerErrors, planStatus)
    };
}
export function mergedRunResult(sources: NonEmptyReadonlyArray<MergeSource>): RunRecordResult {
    const [ first, ...remaining ] = sources;
    const results: Results = [
        first.record.result,
        ...remaining.map(function result(source) {
            return source.record.result;
        })
    ];
    return {
        ...first.record.result,
        ...mergeOutcomes(results),
        bySuite: mergedSuites(results),
        artifacts: results.flatMap(function artifacts(result) {
            return result.artifacts;
        }),
        perTest: results.flatMap(function tests(result) {
            return result.perTest;
        }),
        processUsage: null,
        timings: mergedRunTimings(sources)
    };
}
