import type { ReadonlyDeep, JsonValue } from 'type-fest';
import type { TestPlan } from '../../engine/test-plan.ts';
import type { RunResult } from '../../engine/run-result.ts';

export type CheckerExecution = {
    readonly facts: ReadonlyDeep<JsonValue>;
    readonly result: RunResult;
};

export type CollectedCheckerRun = {
    readonly facts: ReadonlyDeep<JsonValue>;
    readonly execute: (signal: AbortSignal) => Promise<CheckerExecution>;
};

export type CheckerPreparation = {
    readonly dispose: () => Promise<void>;
    readonly facts: ReadonlyDeep<JsonValue>;
    readonly testPlan: TestPlan;
    readonly collect: (plan: TestPlan, signal: AbortSignal) => Promise<CollectedCheckerRun>;
};
