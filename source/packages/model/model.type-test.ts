import { suite, test } from '@overkill-dev/test-type-authoring';
import { sameType } from '@overkill-dev/type-test';
import { gen, type PropertyInvocation, type PropertySampleScope } from '../property/property.entry-point.ts';
import type { TestCase } from '../engine/engine.entry-point.ts';
import { isEqualTo } from '../../test-support/type-relations.ts';
import { model, modelScenario } from './model.entry-point.ts';

type Counter = { readonly count: number; };

export const testNode = suite('model authoring', [
    test('infers state, operation, system and reconstruction', function (typeScope) {
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
                typeScope.assert(sameType.withActual<readonly number[]>(), sample.reconstructInput());
                sample.assert.equal(system.count, state);
            }
        };
        typeScope.assert(
            sameType.withActual<true>(),
            isEqualTo<PropertyInvocation<readonly number[]>>()(modelScenario(definition))
        );
        typeScope.assert(
            sameType.withActual<true>(),
            isEqualTo<TestCase>()(model({ ...definition, title: 'counter', settings: {} }))
        );
        return typeScope.assert.collect();
    })
]);
