import { describe, expect, test } from 'tstyche';
import { gen, type PropertyInvocation, type PropertySampleScope } from '../property/property.entry-point.ts';
import type { TestCase } from '../engine/engine.entry-point.ts';
import { model, modelScenario } from './model.entry-point.ts';

type Counter = { readonly count: number; };

describe('model authoring', function () {
    test('infers state, operation, system and reconstruction', function () {
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
                expect(sample.reconstructInput()).type.toBe<readonly number[]>();
                sample.assert.equal(system.count, state);
            }
        };
        expect(modelScenario(definition)).type.toBe<PropertyInvocation<readonly number[]>>();
        expect(model({ ...definition, title: 'counter', settings: {} })).type.toBe<TestCase>();
    });
});
