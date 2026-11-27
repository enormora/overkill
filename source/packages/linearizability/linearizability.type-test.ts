import type { IsEqual } from 'type-fest';
import { suite, test } from '@overkill-dev/test';
import { assignableTo, sameType } from '@overkill-dev/type-test';
import type { PropertyBody } from '../property/property.entry-point.ts';
import type { ModelTransition } from '../model/model.entry-point.ts';
import {
    checkLinearizability,
    linearizability,
    type LinearizabilityProgram,
    type LinearizabilityResult,
    type LinearizabilityTransition
} from './linearizability.entry-point.ts';

export const testNode = suite('linearizability', [
    test('infers observation types and accepts deterministic model transitions', function (typeScope) {
        typeScope.assert(assignableTo<ModelTransition<number>, LinearizabilityTransition<number>>());
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
                    typeScope.assert(sameType.withActual<number>(), state);
                    typeScope.assert(sameType.withActual<number>(), observation.operation);
                    if (observation.outcome.kind === 'returned') {
                        typeScope.assert(sameType.withActual<string>(), observation.outcome.value);
                    }
                    return { kind: 'alternatives', states: [ state, state + 1 ] };
                }
            },
            maxWork: 100,
            signal: controller.signal
        });
        typeScope.assert(sameType.withActual<Promise<LinearizabilityResult>>(), result);
        return typeScope.assert.collect();
    }),
    test('infers concurrent operation and output types', function (typeScope) {
        const body = linearizability({
            create() {
                return { value: 0 };
            },
            run(operation: number, system, signal) {
                typeScope.assert(sameType.withActual<number>(), system.value);
                typeScope.assert(sameType.withActual<AbortSignal>(), signal);
                return String(operation);
            },
            model: {
                initial() {
                    return 0;
                },
                transition(state, observation) {
                    typeScope.assert(sameType.withActual<number>(), observation.operation);
                    if (observation.outcome.kind === 'returned') {
                        typeScope.assert(sameType.withActual<string>(), observation.outcome.value);
                    }
                    return { kind: 'enabled', state };
                }
            },
            maxWork: 100
        });
        typeScope.assert(sameType<IsEqual<typeof body, PropertyBody<LinearizabilityProgram<number>>>, true>());
        return typeScope.assert.collect();
    })
]);
