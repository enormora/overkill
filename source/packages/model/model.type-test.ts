import { suite, test } from '../test/test.entry-point.ts';
import { sameType } from '../type-test/type-test.entry-point.ts';
import { gen, type PropertyInvocation, type PropertySampleScope } from '../property/property.entry-point.ts';
import type { TestCase } from '../engine/engine.entry-point.ts';
import { isEqualTo } from '../../test-support/type-relations.ts';
import { model, modelScenario } from './model.entry-point.ts';

type Counter = { readonly count: number; };

export const testNode = suite('model authoring', [
    test('infers state, operation, system and reconstruction', function (scope) {
        const definition = {
            initial() {
                return 0;
            },
            commands() {
                return gen.integer({ min: 0, max: 5 });
            },
            transition(state: number, operation: number) {
                return { kind: 'enabled', state: state + operation } as const;
            },
            length: { minLength: 0, maxLength: 5 },
            codec: null,
            examples: [],
            coverage: [],
            create() {
                return { count: 0 };
            },
            run(operation: number, system: Counter) {
                Object.assign(system, { count: system.count + operation });
            },
            check(state: number, system: Counter, sample: PropertySampleScope<readonly number[]>) {
                scope.assert(
                    sameType.withActual<true>(),
                    isEqualTo<readonly number[]>()(sample.reconstructInput())
                );
                sample.assert.equal(system.count, state);
            }
        };
        scope.assert(
            sameType.withActual<true>(),
            isEqualTo<PropertyInvocation<readonly number[]>>()(modelScenario(definition))
        );
        scope.assert(
            sameType.withActual<true>(),
            isEqualTo<TestCase>()(model({ ...definition, title: 'counter', settings: {} }))
        );
        return scope.assert.collect();
    })
]);
