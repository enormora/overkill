import type { IsEqual } from 'type-fest';
import { suite, test } from '../../../tools/type-tests/authoring.entry-point.ts';
import { acceptsCall, assignableFrom, rejectsCall, sameType } from '../../../tools/type-tests/relations.entry-point.ts';
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

declare const projectSettingsUnderTest: typeof prepareFamily<ProjectSettings>;

export const testNode = suite('test family', [
    test('family settings retain the parser result type', function (typeScope) {
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
        typeScope.assert(sameType<IsEqual<typeof family, TestFamily<ProjectSettings>>, true>());
        typeScope.assert(sameType.withActual<ProjectSettings>(), family.parseSettings(null));
        return typeScope.assert.collect();
    }),
    test('metadata views retain branding without erasing callable settings', function (typeScope) {
        typeScope.assert(assignableFrom.not<keyof DefinedTestFamily, 'load' | 'parseSettings'>());
        typeScope.assert(sameType<[TestFamilyDefinition<null>] extends [DefinedTestFamily] ? true : false, false>());
        typeScope.assert(
            sameType<
                [TestFamily<ProjectSettings>] extends [TestFamily<{ readonly iterations: number; }>] ? true : false,
                false
            >()
        );
        return typeScope.assert.collect();
    }),
    test('direct family execution requires branded values and exact settings', function (typeScope) {
        typeScope.assert(
            sameType<
                [{ readonly testPlan: TestPlan; readonly facts: FamilyRunFacts; }] extends [CollectedFamilyRun] ? true
                    : false,
                false
            >()
        );
        typeScope.assert(
            sameType<
                [Pick<PreparedFamilyRun, keyof AsyncDisposable | 'collect' | 'testPlan'>] extends [PreparedFamilyRun]
                    ? true
                    : false,
                false
            >()
        );
        return typeScope.assert.collect();
    }),
    test('preparation infers the settings contract from the definition', function (typeScope) {
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
        typeScope.assert(acceptsCall, async () =>
            projectSettingsUnderTest({
                testPlan: plan,
                projectRoot: '/project',
                signal: executeOptions.signal,
                testFamily: family,
                settings: { project: 'tsconfig.json' }
            }));
        typeScope.assert(rejectsCall('argument-type'), async () =>
            projectSettingsUnderTest({
                testPlan: plan,
                projectRoot: '/project',
                signal: executeOptions.signal,
                testFamily: family,
                settings: { project: 123 }
            }));
        return typeScope.assert.collect();
    }),
    test('collected execution requires a signal', function (typeScope) {
        typeScope.assert(acceptsCall, async () => execute(collectedRun, executeOptions));
        typeScope.assert(rejectsCall('argument-type'), async () => execute(collectedRun));
        return typeScope.assert.collect();
    }),
    test('prepared facts are available without collection evidence', function (typeScope) {
        typeScope.assert(sameType<PreparedFamilyRun['facts'], FamilyPreparationFacts>());
        typeScope.assert(assignableFrom.not<keyof FamilyPreparationFacts, 'collection'>());
        return typeScope.assert.collect();
    })
]);
