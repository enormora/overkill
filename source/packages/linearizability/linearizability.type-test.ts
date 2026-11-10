import { expect, test } from 'tstyche';
import type { PropertyBody } from '../property/property.entry-point.ts';
import type { ModelTransition } from '../model/model.entry-point.ts';
import {
    checkLinearizability,
    linearizability,
    type LinearizabilityProgram,
    type LinearizabilityResult,
    type LinearizabilityTransition
} from './linearizability.entry-point.ts';

test('infers observation types and accepts deterministic model transitions', function () {
    expect<ModelTransition<number>>().type.toBeAssignableTo<LinearizabilityTransition<number>>();
    const controller = new AbortController();
    const result = checkLinearizability({
        history: [ { kind: 'invoke', id: 'one', operation: 1 }, {
            kind: 'respond',
            id: 'one',
            outcome: { kind: 'returned', value: 'one' }
        } ],
        model: {
            initial() {
                return 0;
            },
            transition(state, observation) {
                expect(state).type.toBe<number>();
                expect(observation.operation).type.toBe<number>();
                if (observation.outcome.kind === 'returned') {
                    expect(observation.outcome.value).type.toBe<string>();
                }
                return { kind: 'alternatives', states: [ state, state + 1 ] };
            }
        },
        maxWork: 100,
        signal: controller.signal
    });
    expect(result).type.toBe<Promise<LinearizabilityResult>>();
});

test('infers concurrent operation and output types', function () {
    const body = linearizability({
        create() {
            return { value: 0 };
        },
        run(operation: number, system, signal) {
            expect(system.value).type.toBe<number>();
            expect(signal).type.toBe<AbortSignal>();
            return String(operation);
        },
        model: {
            initial() {
                return 0;
            },
            transition(state, observation) {
                expect(observation.operation).type.toBe<number>();
                if (observation.outcome.kind === 'returned') {
                    expect(observation.outcome.value).type.toBe<string>();
                }
                return { kind: 'enabled', state };
            }
        },
        maxWork: 100
    });
    expect(body).type.toBe<
        PropertyBody<LinearizabilityProgram<number>>
    >();
});
