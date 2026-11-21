import { table, suite, test } from '@overkill-dev/test';

import { familyReplayProfile } from '../test-support/family-replay-profile.ts';
import { defaultMicrotestProfile } from '../test-support/run-command-factory.ts';

import { isRecordedFamilyProfile, restoreFamilyReplayProfile } from './replay-family-profile.ts';

export const testNode = suite('recorded family profile restoration', [
    test('restores frozen settings while retaining the configured family', async function (scope) {
        const fixture = familyReplayProfile();
        const restored = await restoreFamilyReplayProfile(fixture.saved, fixture.current);
        scope.assert.equal(restored.testFamily, fixture.current.testFamily);
        scope.assert.equal(restored.settings, null);
        scope.assert.deepEqual(restored.execution, fixture.current.execution);
        scope.assert.equal(restored.reporters, fixture.current.reporters);
        return scope.assert.collect();
    }),
    test('requires compatible configuration for a family without a module', async function (scope) {
        const fixture = familyReplayProfile();
        await scope.assert.rejects(async function () {
            await restoreFamilyReplayProfile(fixture.saved, undefined);
        }, { message: 'Recorded family requires an explicit compatible configuration.' });
        return scope.assert.collect();
    }),
    test('rejects a built-in profile replacing the recorded family', async function (scope) {
        const fixture = familyReplayProfile();
        await scope.assert.rejects(async function () {
            await restoreFamilyReplayProfile(fixture.saved, defaultMicrotestProfile());
        }, { message: 'Recorded family configuration changed; collect a new run.' });
        return scope.assert.collect();
    }),
    test('rejects configured settings that differ from the recording', async function (scope) {
        const fixture = familyReplayProfile();
        await scope.assert.rejects(async function () {
            await restoreFamilyReplayProfile(fixture.saved, { ...fixture.current, settings: { changed: true } });
        }, { message: 'Recorded family configuration settings changed; collect a new run.' });
        return scope.assert.collect();
    }),
    table({
        title: 'rejects changed family identity',
        cases: [ { id: 'changed', version: '1' }, { id: '@example/analysis', version: '2' } ] as const,
        caseTitle(identity) {
            return `${identity.id}, ${identity.version}`;
        },
        async test(scope) {
            const identity = scope.parameters;

            const fixture = familyReplayProfile();
            await scope.assert.rejects(async function () {
                await restoreFamilyReplayProfile(fixture.saved, {
                    ...fixture.current,
                    testFamily: {
                        ...fixture
                            .current
                            .testFamily,
                        ...identity
                    }
                });
            }, { message: 'Frozen family identity or implementation version changed; collect a new run.' });
            return scope.assert.collect();
        }
    }),
    test('recognizes only tagged recorded family profiles', function (scope) {
        const fixture = familyReplayProfile();
        scope.assert.true(isRecordedFamilyProfile(fixture.saved));
        scope.assert.false(isRecordedFamilyProfile(null));
        scope.assert.false(isRecordedFamilyProfile('family'));
        scope.assert.false(isRecordedFamilyProfile({ kind: 'other' }));
        return scope.assert.collect();
    })
]);
