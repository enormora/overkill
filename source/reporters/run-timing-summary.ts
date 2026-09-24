import type { RunResult } from '../engine/run-result.ts';

const microsecondsPerMillisecond = 1000;

function milliseconds(microseconds: number): number {
    return Math.round(microseconds / microsecondsPerMillisecond);
}

export function formatTimingSummary(result: RunResult): string {
    const { summary } = result.timings;

    return `total ${milliseconds(summary.totalWallTimeMicroseconds)} ms, ` +
        `execution ${milliseconds(summary.testExecutionWallTimeMicroseconds)} ms, ` +
        `overhead ${milliseconds(summary.runnerOverheadWallTimeMicroseconds)} ms`;
}
