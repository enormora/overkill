import { runIfMain } from '#test-runner';
import { isDefinedFamilyProfile, type DefinedFamilyProfile } from '../config/types.ts';
import { suite, test } from '../packages/test/test.entry-point.ts';
import { defineTestFamily } from '../packages/engine/engine.entry-point.ts';
import { normalizeConfig } from '../packages/run/run.entry-point.ts';
import { family } from '../integration-tests/run/fixtures/imported-runtime-family.ts';
import { completedHistoryRecord } from '../test-support/history-record-fixture.ts';
import { historyRecordSchema } from './history-record.ts';
import { recordedReplayProfile } from './run-record-input.ts';
import { restoreFamilyReplayProfile } from './replay-family-profile.ts';

function familyProfile(): DefinedFamilyProfile {
    const config = normalizeConfig({
        profiles: {
            custom: {
                testFamily: family,
                settings: null,
                files: { include: [ 'custom.ts' ] },
                execution: { processModel: 'in-process', scheduling: 'serial' }
            }
        }
    });
    const profile = config.profiles.custom;
    if (profile === undefined || !isDefinedFamilyProfile(profile)) {
        throw new Error('Missing test profile.');
    }
    return profile;
}

export const testNode = suite('family record compatibility', [
    test('serializes a family profile without executable definitions', async function (scope) {
        const profile = familyProfile();
        const serialized = JSON.stringify(recordedReplayProfile(profile));
        const restored = await restoreFamilyReplayProfile(JSON.parse(serialized), profile);
        scope.assert.equal(restored.testFamily, family);
        scope.assert.equal(restored.settings, null);
        scope.assert.equal(serialized.includes('parseSettings'), false);
        scope.assert.equal(serialized.includes('load'), false);
        return scope.assert.collect();
    }),
    test('rejects a changed implementation version before backend loading', async function (scope) {
        const profile = familyProfile();
        const changed = defineTestFamily({
            ...family,
            version: '2',
            async load() {
                throw new Error('Backend loaded before compatibility validation.');
            }
        });
        await scope.assert.rejects(async function restoreChangedFamily() {
            await restoreFamilyReplayProfile(recordedReplayProfile(profile), { ...profile, testFamily: changed });
        }, { message: 'Frozen family identity or implementation version changed; collect a new run.' });
        return scope.assert.collect();
    }),
    ...([ 1, 2, 3 ] as const).map(function historicalVersion(version) {
        return test(`inspects version ${version} without resolving family modules`, function (scope) {
            const record = completedHistoryRecord('historical');
            const parsed = historyRecordSchema.parse({
                ...record,
                version,
                facts: { execution: { testFamily: '@missing/checker' } },
                replayProfile: {
                    kind: 'family',
                    family: {
                        id: '@missing/checker',
                        version: 'historical',
                        module: { moduleUrl: 'file:///missing/checker.ts', exportName: 'family' }
                    },
                    policy: {}
                }
            });
            scope.assert.equal(parsed.version, version);
            scope.assert.equal(parsed.facts?.execution.testFamily, '@missing/checker');
            return scope.assert.collect();
        });
    })
]);

await runIfMain(import.meta, testNode);
