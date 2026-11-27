import { isEqualTo } from '../../test-support/type-relations.ts';
import { test } from '@overkill-dev/test';
import { sameType } from '@overkill-dev/type-test';
import type { Suite } from '../engine/engine.entry-point.ts';
import { gen } from '../property/property.entry-point.ts';
import { defineConfigTests, type ConfigInput, type ConfigSource } from './eslint-test.entry-point.ts';

export const testNode = test('retains named config selection and independent suite types', function (typeScope) {
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
    typeScope.assert(sameType.withActual<true>(), isEqualTo<Suite>()(definition.checks()));
    typeScope.assert(sameType.withActual<true>(), isEqualTo<Suite>()(definition.fixtures()));
    typeScope.assert(sameType.withActual<true>(), isEqualTo<Suite>()(definition.properties()));
    return typeScope.assert.collect();
});
