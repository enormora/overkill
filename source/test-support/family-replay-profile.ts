import { normalizeConfig } from '../config/config.ts';
import { recordedReplayProfile } from '../run/run-record-input.ts';
import type { DefinedFamilyProfile } from '../config/types.ts';
import { analysisFixture } from './family-analysis-fixture.ts';

type FamilyReplayProfileFixture = { readonly current: DefinedFamilyProfile; readonly saved: unknown; };
export function familyReplayProfile(): FamilyReplayProfileFixture {
    const family = analysisFixture(function () {
        return undefined;
    }, 'complete');
    const config = normalizeConfig({
        profiles: { analysis: { testFamily: family, settings: null, files: { include: [ 'source/case.ts' ] } } }
    });
    const current = config.profiles['analysis'];
    if (current === undefined || typeof current.testFamily === 'string') {
        throw new Error('Expected a defined family profile.');
    }
    return { current, saved: recordedReplayProfile(current) };
}
