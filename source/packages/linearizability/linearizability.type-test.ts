import { suite, test } from '../../../tools/type-tests/authoring.entry-point.ts';
import { sameType } from '../../../tools/type-tests/relations.entry-point.ts';
import type { PropertyBody } from '../property/property.entry-point.ts';
import type { ModelTransition } from '../model/model.entry-point.ts';
import { isEqualTo, type IsAssignable } from '../../test-support/type-relations.ts';
import {
    checkLinearizability,
    linearizability,
    type LinearizabilityProgram,
    type LinearizabilityResult,
    type LinearizabilityTransition
} from './linearizability.entry-point.ts';

export const testNode = suite('linearizability', [
    test('infers observation types and accepts deterministic model transitions', function (typeScope) {
        typeScope.assert(sameType<IsAssignable<ModelTransition<number>, LinearizabilityTransition<number>>, true>());
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
        typeScope.assert(sameType.withActual<true>(), isEqualTo<Promise<LinearizabilityResult>>()(result));
        return typeScope.assert.collect();
    }),
    test('infers concurrent operation and output types', function (typeScope) {
        const body = linearizability({
            create() {
                return { value: 0 };
            },
            run(operation: number, system, signal) {
                typeScope.assert(sameType.withActual<number>(), system.value);
                typeScope.assert(sameType.withActual<true>(), isEqualTo<AbortSignal>()(signal));
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
        typeScope.assert(sameType.withActual<true>(), isEqualTo<PropertyBody<LinearizabilityProgram<number>>>()(body));
        return typeScope.assert.collect();
    })
]);
