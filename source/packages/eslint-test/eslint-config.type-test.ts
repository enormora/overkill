import { expect, test } from 'tstyche';
import type { Suite } from '../engine/engine.entry-point.ts';
import { gen } from '../property/property.entry-point.ts';
import { defineConfigTests, type ConfigInput, type ConfigSource } from './eslint-test.entry-point.ts';

test('retains named config selection and independent suite types', function () {
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
    expect(definition.checks()).type.toBe<Suite>();
    expect(definition.fixtures()).type.toBe<Suite>();
    expect(definition.properties()).type.toBe<Suite>();
});
