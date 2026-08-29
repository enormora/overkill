import type { CaseId } from '../engine/identity.ts';
import type { ReporterEvent } from '../engine/reporter.ts';
import type { ResourceUsageSnapshot, RunResult } from '../engine/run-result.ts';
import type {
    CollectedRunPlan,
    RunEngineSelection,
    RunResourceBudgets,
    RunScheduling,
    RunTestFamily
} from './run-types.ts';

type SupervisedCommandBase = {
    readonly capabilityRestrictions: {
        readonly mode: 'disabled' | 'enabled';
    };
    readonly collectionTimeoutMilliseconds: number;
    readonly cwd: string;
    readonly engine: Exclude<RunEngineSelection, { readonly kind: 'instance'; }>;
    readonly paths: readonly string[];
    readonly hardTimeoutMilliseconds: number;
    readonly resourceBudgets: RunResourceBudgets;
    readonly resourceUsageSamplingIntervalMilliseconds: number;
    readonly scheduling: RunScheduling;
    readonly testFamily: RunTestFamily;
    readonly timeoutMilliseconds: number;
};

export type SupervisedCollectCommand = SupervisedCommandBase & {
    readonly kind: 'collect';
};

export type SupervisedRunCommand = SupervisedCommandBase & {
    readonly kind: 'run';
};

export type SupervisedChildCommand = SupervisedCollectCommand | SupervisedRunCommand;

export type SupervisedAssignmentCommand = {
    readonly assignedCases: readonly CaseId[];
    readonly kind: 'assign';
};

export type SupervisedChildMessage = {
    readonly collectedPlan: CollectedRunPlan;
    readonly kind: 'collected';
    readonly runnerErrors: readonly RunResult['runnerErrors'][number][];
} | {
    readonly event: ReporterEvent;
    readonly kind: 'event';
} | {
    readonly kind: 'result';
    readonly result: RunResult;
} | {
    readonly kind: 'sample';
    readonly sample: ResourceUsageSnapshot;
};
