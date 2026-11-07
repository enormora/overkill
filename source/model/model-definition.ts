import type {
    Generator as PropertyGenerator,
    LengthBounds,
    PropertyCoverageRequirement,
    PropertyExample,
    PropertyInputCodec,
    PropertySampleScope,
    PropertySettings
} from '../packages/property/property.entry-point.ts';

export type ModelTransition<State> = { readonly kind: 'disabled'; } | {
    readonly kind: 'enabled';
    readonly state: State;
};

export type ModelMachine<State, Operation> = {
    readonly initial: () => State;
    readonly commands: (state: Readonly<State>) => PropertyGenerator<Operation> | null;
    readonly transition: (state: Readonly<State>, operation: Readonly<Operation>) => ModelTransition<State>;
};

export type ModelScenarioDefinition<State, Operation, System> = ModelMachine<State, Operation> & {
    readonly length: LengthBounds;
    readonly codec: PropertyInputCodec<readonly Operation[]> | null;
    readonly examples: readonly PropertyExample<readonly Operation[]>[];
    readonly coverage: readonly PropertyCoverageRequirement[];
    readonly create: (sample: PropertySampleScope<readonly Operation[]>) => Promise<System> | System;
    readonly run: (
        operation: Operation,
        system: System,
        sample: PropertySampleScope<readonly Operation[]>
    ) => Promise<void> | void;
    readonly check: (
        state: Readonly<State>,
        system: System,
        sample: PropertySampleScope<readonly Operation[]>
    ) => Promise<void> | void;
};

export type ModelDefinition<State, Operation, System> = ModelScenarioDefinition<State, Operation, System> & {
    readonly title: string;
    readonly settings: PropertySettings;
};
