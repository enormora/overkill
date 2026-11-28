import type { IsEqual } from 'type-fest';
import { suite, test } from '@overkill-dev/test';
import { acceptsCall, assignableFrom, rejectsCall, sameType } from '@overkill-dev/type-test';
import { isEqualTo } from '../../test-support/type-relations.ts';
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

export const testNode = suite('Family definitions and execution contracts', [
    test('family settings retain the parser result type', function (scope) {
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
        scope.assert(sameType<IsEqual<typeof family, TestFamily<ProjectSettings>>, true>());
        scope.assert(sameType.withActual<true>(), isEqualTo<ProjectSettings>()(family.parseSettings(null)));
        return scope.assert.collect();
    }),
    test('metadata views retain branding without erasing callable settings', function (scope) {
        scope.assert(assignableFrom.not<keyof DefinedTestFamily, 'load' | 'parseSettings'>());
        scope.assert(sameType<[TestFamilyDefinition<null>] extends [DefinedTestFamily] ? true : false, false>());
        scope.assert(
            sameType<
                [TestFamily<ProjectSettings>] extends [TestFamily<{ readonly iterations: number; }>] ? true : false,
                false
            >()
        );
        return scope.assert.collect();
    }),
    test('direct family execution requires branded values and exact settings', function (scope) {
        scope.assert(
            sameType<
                [{ readonly testPlan: TestPlan; readonly facts: FamilyRunFacts; }] extends [CollectedFamilyRun] ? true
                    : false,
                false
            >()
        );
        scope.assert(
            sameType<
                [Pick<PreparedFamilyRun, keyof AsyncDisposable | 'collect' | 'testPlan'>] extends [PreparedFamilyRun]
                    ? true
                    : false,
                false
            >()
        );
        return scope.assert.collect();
    }),
    test('preparation infers the settings contract from the definition', function (scope) {
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
        scope.assert(acceptsCall, async function () {
            return projectSettingsUnderTest({
                testPlan: plan,
                projectRoot: '/project',
                signal: executeOptions.signal,
                testFamily: family,
                settings: { project: 'tsconfig.json' }
            });
        });
        scope.assert(rejectsCall('argument-type'), async function () {
            return projectSettingsUnderTest({
                testPlan: plan,
                projectRoot: '/project',
                signal: executeOptions.signal,
                testFamily: family,
                settings: { project: 123 }
            });
        });
        return scope.assert.collect();
    }),
    test('collected execution requires a signal', function (scope) {
        scope.assert(acceptsCall, async function () {
            return execute(collectedRun, executeOptions);
        });
        scope.assert(rejectsCall('argument-type'), async function () {
            return execute(collectedRun);
        });
        return scope.assert.collect();
    }),
    test('prepared facts are available without collection evidence', function (scope) {
        scope.assert(sameType<IsEqual<PreparedFamilyRun['facts'], FamilyPreparationFacts>, true>());
        scope.assert(assignableFrom.not<keyof FamilyPreparationFacts, 'collection'>());
        return scope.assert.collect();
    })
]);
