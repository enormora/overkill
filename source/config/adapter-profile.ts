import type { ReadonlyDeep, JsonValue } from 'type-fest';
import type { TestPlan } from '../engine/test-plan.ts';
import type { RunResult } from '../engine/run-result.ts';

export type AdapterRunFacts = {
    readonly id: string;
    readonly facts: ReadonlyDeep<JsonValue>;
};

export type PreparedAdapterRun = {
    readonly facts: ReadonlyDeep<JsonValue>;
    readonly execute: () => Promise<RunResult>;
};

export type CollectedAdapterRun = {
    readonly facts: ReadonlyDeep<JsonValue>;
    readonly lower: () => Promise<PreparedAdapterRun>;
};

export type AdapterPreparation = {
    readonly testPlan: TestPlan;
    readonly collect: (plan: TestPlan) => Promise<CollectedAdapterRun>;
};

export type RunProfileAdapter = {
    readonly prepare: (plan: TestPlan, settings: unknown) => Promise<AdapterPreparation>;
};

export type RunAdapterRegistration = {
    readonly id: string;
    readonly validate: (settings: unknown) => void;
    readonly load: () => Promise<RunProfileAdapter>;
};

export function isRunAdapterRegistration(value: unknown): value is RunAdapterRegistration {
    return typeof value === 'object' && value !== null &&
        typeof Reflect.get(value, 'id') === 'string' &&
        typeof Reflect.get(value, 'validate') === 'function' && typeof Reflect.get(value, 'load') === 'function';
}
