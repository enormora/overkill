import type { ReporterEvent } from '../engine/reporter.ts';
import type { ResourceUsageSnapshot, RunResult } from '../engine/run-result.ts';
import type { RunResourceBudgets } from './run-types.ts';

export type SupervisedRunCommand = {
    readonly assignedCaseKeys: readonly string[];
    readonly cwd: string;
    readonly hardTimeoutMilliseconds: number;
    readonly kind: 'run';
    readonly paths: readonly string[];
    readonly resourceBudgets: RunResourceBudgets;
    readonly resourceUsageSamplingIntervalMilliseconds: number;
    readonly timeoutMilliseconds: number;
};

export type SupervisedChildMessage = {
    readonly event: ReporterEvent;
    readonly kind: 'event';
} | {
    readonly kind: 'result';
    readonly result: RunResult;
} | {
    readonly kind: 'sample';
    readonly sample: ResourceUsageSnapshot;
};
