import type { ReporterEvent } from '../engine/reporter.ts';
import type { ResourceUsageSnapshot, RunResult } from '../engine/run-result.ts';
import type { RunResourceBudgets, RunScheduling } from './run-types.ts';

export type SupervisedRunCommand = {
    readonly assignedCaseKeys: readonly string[];
    readonly capabilityRestrictions: {
        readonly mode: 'disabled' | 'enabled';
    };
    readonly cwd: string;
    readonly hardTimeoutMilliseconds: number;
    readonly kind: 'run';
    readonly paths: readonly string[];
    readonly resourceBudgets: RunResourceBudgets;
    readonly resourceUsageSamplingIntervalMilliseconds: number;
    readonly scheduling: RunScheduling;
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
