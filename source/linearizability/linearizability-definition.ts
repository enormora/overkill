import type { PropertySampleScope } from '../packages/property/property.entry-point.ts';
import type { ModelTransition } from '../packages/model/model.entry-point.ts';

type ReturnedOutcome<Output> = { readonly kind: 'returned'; readonly value: Output; };
type ThrownOutcome = { readonly kind: 'threw'; readonly error: unknown; };
export type LinearizabilityOutcome<Output> = ReturnedOutcome<Output> | ThrownOutcome;

export type LinearizabilityObservation<Operation, Output> = {
    readonly operation: Operation;
    readonly outcome: LinearizabilityOutcome<Output> | { readonly kind: 'pending'; };
};

type Invocation<Operation> = { readonly kind: 'invoke'; readonly id: string; readonly operation: Operation; };
type Response<Output> = {
    readonly kind: 'respond';
    readonly id: string;
    readonly outcome: LinearizabilityOutcome<Output>;
};
export type LinearizabilityEvent<Operation, Output> = Invocation<Operation> | Response<Output>;

export type LinearizabilityTransition<State> = ModelTransition<State> | {
    readonly kind: 'alternatives';
    readonly states: readonly [State, State, ...(readonly State[])];
};

export type LinearizabilityModel<State, Operation, Output> = {
    readonly initial: () => State;
    readonly transition: (
        state: Readonly<State>,
        observation: Readonly<LinearizabilityObservation<Operation, Output>>
    ) => LinearizabilityTransition<State>;
};

export type LinearizabilityRequest<State, Operation, Output> = {
    readonly history: readonly LinearizabilityEvent<Operation, Output>[];
    readonly model: LinearizabilityModel<State, Operation, Output>;
    readonly maxWork: number;
    readonly signal: AbortSignal;
};

type Linearizable = { readonly kind: 'linearizable'; readonly order: readonly string[]; readonly work: number; };
type NotLinearizable = {
    readonly kind: 'not-linearizable';
    readonly prefix: readonly string[];
    readonly work: number;
};
type Inconclusive = {
    readonly kind: 'inconclusive';
    readonly reason: 'max-work';
    readonly prefix: readonly string[];
    readonly work: number;
};
export type LinearizabilityResult = Inconclusive | Linearizable | NotLinearizable;

export type LinearizabilityProgram<Operation> = readonly (readonly Operation[])[];

export type LinearizabilityDefinition<State, Operation, Output, System> = {
    readonly model: LinearizabilityModel<State, Operation, Output>;
    readonly maxWork: number;
    readonly create: (sample: PropertySampleScope) => Promise<System> | System;
    readonly run: (operation: Operation, system: System, signal: AbortSignal) => Output | Promise<Output>;
};
