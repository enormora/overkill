import { property, type PropertyInvocation } from '../packages/property/property.entry-point.ts';
import type { TestCase } from '../packages/engine/engine.entry-point.ts';
import type { ModelDefinition, ModelScenarioDefinition } from './model-definition.ts';
import { modelTrace } from './model-trace.ts';
import { modelExecution } from './model-execution.ts';

export function modelScenario<State, Operation, System>(
    definition: ModelScenarioDefinition<State, Operation, System>
): PropertyInvocation<readonly Operation[]> {
    const snapshot = Object.freeze({
        ...definition,
        length: Object.freeze({ ...definition.length }),
        examples: Object.freeze(Array.from(definition.examples)),
        coverage: Object.freeze(definition.coverage.map(function (requirement) {
            return Object.freeze({ ...requirement });
        }))
    });
    const generator = modelTrace(snapshot, snapshot.length);
    const invocation = {
        generator: snapshot.codec === null ? generator : generator.withCodec(snapshot.codec),
        examples: snapshot.examples,
        coverage: snapshot.coverage,
        test: modelExecution(snapshot)
    };
    return Object.freeze(invocation);
}

export function model<State, Operation, System>(definition: ModelDefinition<State, Operation, System>): TestCase {
    return property({ title: definition.title, settings: definition.settings, ...modelScenario(definition) });
}
