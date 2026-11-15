import { builtinTestFamily } from '../engine/builtin-test-families.ts';
import type { FamilyRunFacts } from '../engine/family-run.ts';
import type { ProfileConfig } from '../config/types.ts';

export function profileFamilyFacts(profile: ProfileConfig): FamilyRunFacts {
    const family = typeof profile.testFamily === 'string' ? builtinTestFamily(profile.testFamily) : profile.testFamily;
    return {
        id: family.id,
        version: family.version,
        settings: typeof profile.testFamily === 'string' ? null : profile.settings,
        preparation: null,
        collection: null
    };
}
