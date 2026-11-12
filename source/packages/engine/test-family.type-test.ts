import { expect, test } from 'tstyche';
import {
    defineTestFamily,
    execute,
    type prepareFamily,
    type CollectedFamilyRun,
    type FamilyExecuteOptions,
    type FamilyRunFacts,
    type FamilyPreparationFacts,
    type PreparedFamilyRun,
    type TestPlan,
    type TestFamily,
    type TestFamilyDefinition,
    type DefinedTestFamily
} from './engine.entry-point.ts';

declare const plan: TestPlan;
declare const collectedRun: CollectedFamilyRun;
declare const executeOptions: FamilyExecuteOptions;

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

test('direct family execution requires branded values and exact settings', function () {
    expect<{ readonly testPlan: TestPlan; readonly facts: FamilyRunFacts; }>().type.not.toBeAssignableTo<
        CollectedFamilyRun
    >();
    expect<Pick<PreparedFamilyRun, keyof AsyncDisposable | 'collect' | 'testPlan'>>().type.not.toBeAssignableTo<
        PreparedFamilyRun
    >();
});

test('preparation infers the settings contract from the definition', function () {
    const family = defineTestFamily({
        id: '@example/settings',
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
    expect<typeof prepareFamily<ProjectSettings>>().type.toBeCallableWith({
        testPlan: plan,
        projectRoot: '/project',
        signal: executeOptions.signal,
        testFamily: family,
        settings: { project: 'tsconfig.json' }
    });
    expect<typeof prepareFamily<ProjectSettings>>().type.not.toBeCallableWith({
        testPlan: plan,
        projectRoot: '/project',
        signal: executeOptions.signal,
        testFamily: family,
        settings: { project: 123 }
    });
});

test('collected execution requires a signal', function () {
    expect(execute).type.toBeCallableWith(collectedRun, executeOptions);
    expect(execute).type.not.toBeCallableWith(collectedRun);
});

test('prepared facts are available without collection evidence', function () {
    expect<PreparedFamilyRun['facts']>().type.toBe<FamilyPreparationFacts>();
    expect<keyof FamilyPreparationFacts>().type.not.toBeAssignableFrom<'collection'>();
});
