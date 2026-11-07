import type { PropertyBody, PropertySampleScope } from '../packages/property/property.entry-point.ts';
import type { ModelMachine, ModelScenarioDefinition } from './model-definition.ts';

type ModelStep<State, Operation> = { readonly state: State; readonly operation: Operation; };
type ModelPrediction<State, Operation> = {
    readonly initial: State;
    readonly steps: readonly ModelStep<State, Operation>[];
};

function predictModelTrace<State, Operation>(
    machine: ModelMachine<State, Operation>,
    operations: readonly Operation[],
    prediction: readonly Operation[],
    signal: AbortSignal
): ModelPrediction<State, Operation> {
    const systemOperations = operations.values();
    const initial = machine.initial();
    let state = initial;
    const steps = prediction.map(function predictOperation(operation, index) {
        signal.throwIfAborted();
        const systemOperation = systemOperations.next();
        if (systemOperation.done === true) {
            throw new TypeError('Model reconstruction changed the trace length.');
        }
        const next = machine.transition(state, operation);
        if (next.kind === 'disabled') {
            throw new TypeError(`Model trace contains a disabled operation at index ${index}.`);
        }
        state = next.state;
        return { state, operation: systemOperation.value };
    });
    if (systemOperations.next().done !== true) {
        throw new TypeError('Model reconstruction changed the trace length.');
    }
    return { initial, steps };
}

async function checkOperations<State, Operation, System>(
    definition: ModelScenarioDefinition<State, Operation, System>,
    steps: readonly ModelStep<State, Operation>[],
    system: System,
    sample: PropertySampleScope<readonly Operation[]>
): Promise<void> {
    for (const step of steps) {
        sample.signal.throwIfAborted();
        await definition.run(step.operation, system, sample);
        sample.signal.throwIfAborted();
        await definition.check(step.state, system, sample);
    }
}

export function modelExecution<State, Operation, System>(
    definition: ModelScenarioDefinition<State, Operation, System>
): PropertyBody<readonly Operation[]> {
    return async function evaluateModel(operations, sample) {
        const prediction = predictModelTrace(definition, operations, sample.reconstructInput(), sample.signal);
        sample.signal.throwIfAborted();
        const system = await definition.create(sample);
        sample.signal.throwIfAborted();
        await definition.check(prediction.initial, system, sample);
        await checkOperations(definition, prediction.steps, system, sample);
        return sample.assert.collect();
    };
}
