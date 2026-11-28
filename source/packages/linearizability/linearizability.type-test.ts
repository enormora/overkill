import { suite, test } from '../test/test.entry-point.ts';
import { sameType } from '../type-test/type-test.entry-point.ts';
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

export const testNode = suite('Checking concurrent operation histories', [
    test('infers observation types and accepts deterministic model transitions', function (scope) {
        scope.assert(sameType<IsAssignable<ModelTransition<number>, LinearizabilityTransition<number>>, true>());
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
                    scope.assert(sameType.withActual<number>(), state);
                    scope.assert(sameType.withActual<number>(), observation.operation);
                    if (observation.outcome.kind === 'returned') {
                        scope.assert(sameType.withActual<string>(), observation.outcome.value);
                    }
                    return { kind: 'alternatives', states: [ state, state + 1 ] };
                }
            },
            maxWork: 100,
            signal: controller.signal
        });
        scope.assert(sameType.withActual<true>(), isEqualTo<Promise<LinearizabilityResult>>()(result));
        return scope.assert.collect();
    }),
    test('infers concurrent operation and output types', function (scope) {
        const body = linearizability({
            create() {
                return { value: 0 };
            },
            run(operation: number, system, signal) {
                scope.assert(sameType.withActual<number>(), system.value);
                scope.assert(sameType.withActual<true>(), isEqualTo<AbortSignal>()(signal));
                return String(operation);
            },
            model: {
                initial() {
                    return 0;
                },
                transition(state, observation) {
                    scope.assert(sameType.withActual<number>(), observation.operation);
                    if (observation.outcome.kind === 'returned') {
                        scope.assert(sameType.withActual<string>(), observation.outcome.value);
                    }
                    return { kind: 'enabled', state };
                }
            },
            maxWork: 100
        });
        scope.assert(sameType.withActual<true>(), isEqualTo<PropertyBody<LinearizabilityProgram<number>>>()(body));
        return scope.assert.collect();
    })
]);
