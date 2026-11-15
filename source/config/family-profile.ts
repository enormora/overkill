import {
    isDefinedTestFamily,
    isBoundFamilySettings,
    bindFamilySettings,
    type DefinedTestFamily
} from '../engine/test-family.ts';
import { builtinTestFamily, type BuiltinFamilyId } from '../engine/builtin-test-families.ts';
import type { ProjectDefinedFamilyProfile } from './schema.ts';
import { familySettings, type DefinedFamilyProfile } from './types.ts';
import { normalizeMicrotestExecution, defaultTimeoutPolicy } from './defaults.ts';
import {
    normalizeIntegrationExecution,
    normalizeRequiredProfileFiles,
    normalizeProfilePolicy
} from './profile-normalization.ts';
import { ConfigError } from './config-error.ts';

function validateFamilySettings(profile: DefinedFamilyProfile): void {
    const binding = profile[familySettings];
    if (
        !Object.hasOwn(profile, familySettings) || !isBoundFamilySettings(binding) ||
        binding.testFamily !== profile.testFamily ||
        binding.settings !== profile.settings
    ) {
        throw new ConfigError('Imported profile settings must be normalized with their family.');
    }
}

export function validateFamilyDefinition(profile: DefinedFamilyProfile): void {
    validateFamilySettings(profile);
    if (!profile.testFamily.features.processModels.includes(profile.execution.processModel)) {
        throw new ConfigError('The selected family does not support the configured process model.');
    }
    if (profile.testFamily.features.execution === 'analysis' && profile.processUsage.measure) {
        throw new ConfigError('Analysis profiles do not support runtime process usage policy.');
    }
}

export function normalizeDefinedFamilyProfile(profile: ProjectDefinedFamilyProfile): DefinedFamilyProfile {
    const binding = bindFamilySettings(profile.testFamily, profile.settings);
    const analysis = profile.testFamily.features.execution === 'analysis';
    const execution = profile.execution?.processModel === 'worker-pool'
        ? normalizeIntegrationExecution(profile.execution)
        : normalizeMicrotestExecution(
            profile.execution ?? (analysis
                ? { processModel: 'in-process', scheduling: 'serial', maxConcurrency: 1 }
                : undefined)
        );
    const normalized = {
        ...normalizeProfilePolicy(
            profile,
            analysis
                ? { collectionMilliseconds: 60_000, softMilliseconds: 60_000, hardMilliseconds: 60_000 }
                : defaultTimeoutPolicy
        ),
        execution,
        files: normalizeRequiredProfileFiles(profile.files),
        testFamily: profile.testFamily,
        settings: binding.settings,
        [familySettings]: binding
    };
    validateFamilyDefinition(normalized);
    return normalized;
}

export function validateProfileFamilies(
    profiles: Readonly<
        Record<string, { readonly testFamily: BuiltinFamilyId | DefinedTestFamily; }>
    >
): void {
    const definitions = new Map<string, DefinedTestFamily>(
        ([ 'benchmark', 'integration', 'microtest', 'property' ] as const).map(function definition(id) {
            return [ id, builtinTestFamily(id) ];
        })
    );
    for (const profile of Object.values(profiles)) {
        const family = typeof profile.testFamily === 'string'
            ? builtinTestFamily(profile.testFamily)
            : profile.testFamily;
        const previous = definitions.get(family.id);
        if (previous !== undefined && previous !== family) {
            throw new ConfigError(`Conflicting family implementations: ${family.id}`);
        }
        definitions.set(family.id, family);
    }
}

const profileFamilies: ReadonlySet<string> = new Set([
    'benchmark',
    'integration',
    'microtest',
    'property'
]);
export function validateProfileFamily(profileName: string, testFamily: unknown): void {
    if (isDefinedTestFamily(testFamily)) {
        return;
    }
    if (typeof testFamily !== 'string' || !profileFamilies.has(testFamily)) {
        throw new ConfigError(
            `Invalid profile "${profileName}": testFamily must be one of ${Array.from(profileFamilies).join(', ')}.`
        );
    }
}
