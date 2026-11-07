import type { SerializedValue } from '../compare/serialized-value.ts';
import type { TestPlan } from '../engine/test-plan.ts';
import type { RunResult } from '../engine/run-result.ts';

export type PreparedAdapterRun = {
    readonly facts: SerializedValue;
    readonly execute: () => Promise<RunResult>;
};

export type CollectedAdapterRun = {
    readonly facts: SerializedValue;
    readonly lower: () => Promise<PreparedAdapterRun>;
};

export type RunProfileAdapter = {
    readonly prepare: (plan: TestPlan, settings: unknown) => Promise<TestPlan>;
    readonly collect: (plan: TestPlan, settings: unknown) => Promise<CollectedAdapterRun>;
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
