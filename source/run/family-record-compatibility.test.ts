import { runIfMain } from '#test-runner';
import { isDefinedFamilyProfile, type DefinedFamilyProfile } from '../config/types.ts';
import { suite, test } from '../packages/test/test.entry-point.ts';
import type { TestFamily } from '../packages/engine/engine.entry-point.ts';
import { normalizeConfig } from '../packages/run/run.entry-point.ts';
import { family } from '../integration-tests/run/fixtures/imported-runtime-family.ts';
import { recordedReplayProfile } from './run-record-input.ts';
import { restoreFamilyReplayProfile } from './replay-family-profile.ts';

function familyProfile(definition: TestFamily<null>): DefinedFamilyProfile {
    const config = normalizeConfig({
        profiles: {
            custom: {
                testFamily: definition,
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

export const testNode = suite('family module restoration integration', [
    test('restores a named family module when no current configuration supplies it', async function (scope) {
        const saved = recordedReplayProfile(familyProfile(family));
        const restored = await restoreFamilyReplayProfile(saved, undefined);
        scope.assert.equal(restored.testFamily, family);
        scope.assert.equal(restored.settings, null);
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);
