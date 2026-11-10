import { expect, test } from 'tstyche';
import {
    defineTestFamily,
    type TestFamily,
    type TestFamilyDefinition,
    type DefinedTestFamily
} from './engine.entry-point.ts';

type ProjectSettings = { readonly project: string; };

test('family settings retain the parser result type', function () {
    const family = defineTestFamily({
        id: '@example/checks',
        version: '1',
        module: null,
        features: { execution: 'analysis', processModels: [ 'in-process' ], profileOptions: [] },
        parseSettings(): ProjectSettings {
            return { project: 'tsconfig.json' };
        },
        async load() {
            throw new Error('Not loaded');
        }
    });
    expect(family).type.toBe<TestFamily<ProjectSettings>>();
    expect(family.parseSettings(null)).type.toBe<ProjectSettings>();
});

test('metadata views retain branding without erasing callable settings', function () {
    expect<keyof DefinedTestFamily>().type.not.toBeAssignableFrom<'load' | 'parseSettings'>();
    expect<TestFamilyDefinition<null>>().type.not.toBeAssignableTo<DefinedTestFamily>();
    expect<TestFamily<ProjectSettings>>().type.not.toBeAssignableTo<
        TestFamily<{ readonly iterations: number; }>
    >();
});
