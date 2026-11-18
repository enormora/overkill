import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { familyReplayProfile } from '../test-support/family-replay-profile.ts';
import { defaultMicrotestProfile } from '../test-support/run-command-factory.ts';
import { testNode as recording } from './family-record-policy.test.ts';
import { isRecordedFamilyProfile, restoreFamilyReplayProfile } from './replay-family-profile.ts';

export const testNode = suite('recorded family profile restoration', [
    recording,
    test('restores frozen settings while retaining the configured family', async function (scope: TestScope) {
        const fixture = familyReplayProfile();
        const restored = await restoreFamilyReplayProfile(fixture.saved, fixture.current);
        scope.assert.equal(restored.testFamily, fixture.current.testFamily);
        scope.assert.equal(restored.settings, null);
        scope.assert.deepEqual(restored.execution, fixture.current.execution);
        scope.assert.equal(restored.reporters, fixture.current.reporters);
        return scope.assert.collect();
    }),
    test('requires compatible configuration for a family without a module', async function (scope: TestScope) {
        const fixture = familyReplayProfile();
        await scope.assert.rejects(async function () {
            await restoreFamilyReplayProfile(fixture.saved, undefined);
        }, { message: 'Recorded family requires an explicit compatible configuration.' });
        return scope.assert.collect();
    }),
    test('rejects a built-in profile replacing the recorded family', async function (scope: TestScope) {
        const fixture = familyReplayProfile();
        await scope.assert.rejects(async function () {
            await restoreFamilyReplayProfile(fixture.saved, defaultMicrotestProfile());
        }, { message: 'Recorded family configuration changed; collect a new run.' });
        return scope.assert.collect();
    }),
    test('rejects configured settings that differ from the recording', async function (scope: TestScope) {
        const fixture = familyReplayProfile();
        await scope.assert.rejects(async function () {
            await restoreFamilyReplayProfile(fixture.saved, { ...fixture.current, settings: { changed: true } });
        }, { message: 'Recorded family configuration settings changed; collect a new run.' });
        return scope.assert.collect();
    }),
    ...([ { id: 'changed', version: '1' }, { id: '@example/analysis', version: '2' } ] as const).map(
        function (identity) {
            return test(
                `rejects changed family identity ${identity.id} at version ${identity.version}`,
                async function (scope: TestScope) {
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
            );
        }
    ),
    test('recognizes only tagged recorded family profiles', function (scope: TestScope) {
        const fixture = familyReplayProfile();
        scope.assert.true(isRecordedFamilyProfile(fixture.saved));
        scope.assert.false(isRecordedFamilyProfile(null));
        scope.assert.false(isRecordedFamilyProfile('family'));
        scope.assert.false(isRecordedFamilyProfile({ kind: 'other' }));
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);
