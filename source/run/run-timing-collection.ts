import type { RunResult } from '../engine/run-result.ts';
import {
    defaultRunTimingSlowestSpanLimit,
    defaultRunTimingSpanLimit,
    preciseTimingReport
} from '../engine/run-timings.ts';
import type { ResolvedRun, TimingCollectionMode } from './run-types.ts';

function emptyPreciseTimingReport(): NonNullable<RunResult['timings']['precise']> {
    return preciseTimingReport({
        aggregationMicroseconds: 0,
        recordingMicroseconds: 0,
        slowestSpanLimit: defaultRunTimingSlowestSpanLimit,
        spanLimit: defaultRunTimingSpanLimit,
        spans: []
    });
}

export function resultWithTimingCollection(
    timingCollection: TimingCollectionMode,
    result: RunResult
): RunResult {
    if (timingCollection !== 'precise' || result.timings.precise !== null) {
        return result;
    }

    return {
        ...result,
        timings: {
            ...result.timings,
            precise: emptyPreciseTimingReport()
        }
    };
}

export function resultWithResolvedTimingCollection(resolvedRun: ResolvedRun, result: RunResult): RunResult {
    return resultWithTimingCollection(resolvedRun.facts.execution.timingCollection, result);
}
