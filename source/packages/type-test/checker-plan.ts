import type { ReadonlyDeep, JsonValue } from 'type-fest';
import type { TestPlan } from '../../engine/test-plan.ts';
import type { RunResult } from '../../engine/run-result.ts';

export type PreparedCheckerRun = {
    readonly facts: ReadonlyDeep<JsonValue>;
    readonly execute: () => Promise<RunResult>;
};

export type CollectedCheckerRun = {
    readonly facts: ReadonlyDeep<JsonValue>;
    readonly lower: () => Promise<PreparedCheckerRun>;
};

export type CheckerPreparation = {
    readonly testPlan: TestPlan;
    readonly collect: (plan: TestPlan) => Promise<CollectedCheckerRun>;
};
