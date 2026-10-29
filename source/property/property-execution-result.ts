import type {
    PropertyFailureObservation,
    PropertyExecutionHost,
    PropertyTrialResult
} from '../packages/engine/engine.entry-point.ts';
import type { GeneratedInput } from './generator-input.ts';
import type { CoverageSnapshot } from './property-coverage.ts';
import type { InputRecipe } from './generator-edges.ts';
import type { PropertyAccounting } from './property-work.ts';

export type PropertyRegressionInputs<Value> = {
    readonly checkedIn: Iterable<InputRecipe<Value>>;
    readonly localCache: Iterable<InputRecipe<Value>>;
};

export type PropertyExecutionResult<Value> = {
    readonly kind: 'completed' | 'coverage-unmet' | 'generation-exhausted' | 'work-exhausted';
    readonly accounting: PropertyAccounting;
    readonly exhaustive: number | null;
    readonly coverage: CoverageSnapshot;
} | {
    readonly kind: 'failed';
    readonly exhaustive: number | null;
    readonly coverage: CoverageSnapshot;
    readonly accounting: PropertyAccounting;
    readonly trial: Exclude<PropertyTrialResult, { readonly kind: 'passed'; }>;
    readonly input: InputRecipe<Value>;
    readonly generated: GeneratedInput<Value> | null;
    readonly failureKey: string | null;
    readonly observation: PropertyFailureObservation;
};

export type PropertyInvocationContext = {
    readonly host: PropertyExecutionHost;
    readonly signal: AbortSignal;
    readonly identity: string;
};
