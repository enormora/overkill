import type { AssertionResult } from '../packages/engine/engine.entry-point.ts';
import type { PropertySampleScope } from '../packages/property/property.entry-point.ts';

type ReturnedOutcome<Output> = { readonly kind: 'returned'; readonly value: Output; };
type ThrownOutcome = { readonly kind: 'threw'; readonly error: unknown; };
export type DifferentialOutcome<Output> = ReturnedOutcome<Output> | ThrownOutcome;

export type DifferentialImplementation<Input, Output> = {
    readonly name: string;
    readonly run: (input: Input, signal: AbortSignal) => Output | Promise<Output>;
};

export type DifferentialObservation<Input, Output> = {
    readonly name: string;
    readonly input: Input;
    readonly outcome: DifferentialOutcome<Output>;
};

export type DifferentialObservations<Input, Output> = readonly [
    DifferentialObservation<Input, Output>,
    DifferentialObservation<Input, Output>,
    ...DifferentialObservation<Input, Output>[]
];

export type DifferentialDefinition<Input, Output> = {
    readonly implementations: readonly [
        DifferentialImplementation<Input, Output>,
        DifferentialImplementation<Input, Output>,
        ...(readonly DifferentialImplementation<Input, Output>[])
    ];
    readonly check: (
        observations: DifferentialObservations<Input, Output>,
        sample: PropertySampleScope<Input>
    ) => AssertionResult | Promise<AssertionResult>;
};
