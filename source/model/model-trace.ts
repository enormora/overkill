import {
    gen,
    type Generator as PropertyGenerator,
    type LengthBounds
} from '../packages/property/property.entry-point.ts';
import type { ModelMachine } from './model-definition.ts';

function traceSuffix<State, Operation>(
    machine: ModelMachine<State, Operation>,
    state: State,
    remaining: number
): PropertyGenerator<readonly Operation[]> {
    if (remaining === 0) {
        return gen.constant(null).map<readonly Operation[]>(function () {
            return [];
        });
    }
    const commands = machine.commands(state);
    if (commands === null) {
        return gen.constant(null).map<readonly Operation[]>(function () {
            return [];
        });
    }
    return commands
        .filter(function enabled(operation) {
            return machine.transition(state, operation).kind === 'enabled';
        })
        .flatMap(function extendTrace(operation) {
            const next = machine.transition(state, operation);
            if (next.kind !== 'enabled') {
                throw new TypeError('Model transitions must be deterministic.');
            }
            return traceSuffix(machine, next.state, remaining - 1).map<readonly Operation[]>(
                function prependOperation(suffix) {
                    return [ operation, ...suffix ];
                }
            );
        });
}

export function modelTrace<State, Operation>(
    machine: ModelMachine<State, Operation>,
    length: LengthBounds
): PropertyGenerator<readonly Operation[]> {
    return gen
        .array(gen.constant(null), length)
        .flatMap(function generateTrace(slots) {
            return traceSuffix(machine, machine.initial(), slots.length);
        })
        .filter(function meetsMinimum(trace) {
            return trace.length >= length.minLength;
        });
}
