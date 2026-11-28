import { test } from '../test/test.entry-point.ts';
import { sameType } from '../type-test/type-test.entry-point.ts';
import type { Suite } from '../engine/engine.entry-point.ts';
import { gen } from '../property/property.entry-point.ts';
import { isEqualTo } from '../../test-support/type-relations.ts';
import { defineConfigTests, type ConfigInput, type ConfigSource } from './eslint-test.entry-point.ts';

export const testNode = test('retains named config selection and independent suite types', function (scope) {
    const configs: Record<'strict', ConfigSource> = { strict: [] };
    const definition = defineConfigTests({
        name: 'policy',
        configs,
        project: { kind: 'virtual', files: {}, dependencies: { kind: 'none' } },
        inventories: [],
        files: [],
        fixtures: [],
        generation: [ {
            title: 'input',
            configs: [ 'strict' ],
            project: { kind: 'virtual', files: {}, dependencies: { kind: 'none' } },
            generator: {
                kind: 'custom',
                input: gen.constant(null).map(function input(): ConfigInput {
                    return { filename: 'file.js', code: '', files: {} };
                })
            }
        } ]
    });
    scope.assert(sameType.withActual<true>(), isEqualTo<Suite>()(definition.checks()));
    scope.assert(sameType.withActual<true>(), isEqualTo<Suite>()(definition.fixtures()));
    scope.assert(sameType.withActual<true>(), isEqualTo<Suite>()(definition.properties()));
    return scope.assert.collect();
});
