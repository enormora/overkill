import { expect, test } from 'tstyche';
import type { ModelTransition } from '../model/model.entry-point.ts';
import {
    checkLinearizability,
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
