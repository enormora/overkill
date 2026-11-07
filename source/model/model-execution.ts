import type { PropertyBody, PropertySampleScope } from '../packages/property/property.entry-point.ts';
import type { ModelMachine, ModelScenarioDefinition } from './model-definition.ts';

type PredictedState<State> = { readonly state: State; };

function predictedStates<State, Operation>(
    machine: ModelMachine<State, Operation>,
    operations: readonly Operation[],
    signal: AbortSignal
): readonly PredictedState<State>[] {
    let state = machine.initial();
    const states = [ { state } ];
    for (const [ index, operation ] of operations.entries()) {
        signal.throwIfAborted();
        const next = machine.transition(state, operation);
        if (next.kind === 'disabled') {
            throw new TypeError(`Model trace contains a disabled operation at index ${index}.`);
        }
        state = next.state;
        states.push({ state });
    }
    return states;
}

function predictionForTrial<State, Operation>(
    machine: ModelMachine<State, Operation>,
    operations: readonly Operation[],
    sample: PropertySampleScope<readonly Operation[]>
): readonly PredictedState<State>[] {
    const prediction = sample.reconstructInput();
    if (prediction.length !== operations.length) {
        throw new TypeError('Model reconstruction changed the trace length.');
    }
    return predictedStates(machine, prediction, sample.signal);
}

type ModelEvaluation<State, Operation, System> = {
    readonly operations: readonly Operation[];
    readonly states: readonly PredictedState<State>[];
    readonly system: System;
    readonly sample: PropertySampleScope<readonly Operation[]>;
};

async function checkOperations<State, Operation, System>(
    definition: ModelScenarioDefinition<State, Operation, System>,
    evaluation: ModelEvaluation<State, Operation, System>
): Promise<void> {
    const { operations, states, system, sample } = evaluation;
    for (const [ index, operation ] of operations.entries()) {
        sample.signal.throwIfAborted();
        await definition.run(operation, system, sample);
        sample.signal.throwIfAborted();
        const expected = states[index + 1];
        if (expected === undefined) {
            throw new TypeError('Model reconstruction changed the trace length.');
        }
        await definition.check(expected.state, system, sample);
    }
}

export function modelExecution<State, Operation, System>(
    definition: ModelScenarioDefinition<State, Operation, System>
): PropertyBody<readonly Operation[]> {
    return async function evaluateModel(operations, sample) {
        const states = predictionForTrial(definition, operations, sample);
        const initial = states[0];
        if (initial === undefined) {
            throw new TypeError('Model prediction requires initial state.');
        }
        sample.signal.throwIfAborted();
        const system = await definition.create(sample);
        sample.signal.throwIfAborted();
        await definition.check(initial.state, system, sample);
        await checkOperations(definition, { operations, states, system, sample });
        return sample.assert.collect();
    };
}
