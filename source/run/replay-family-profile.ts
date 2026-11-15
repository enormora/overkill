import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod/v4';
import { normalizedMicrotestProfileSchema } from '../config/normalized-microtest-schema.ts';
import { familySettings, type DefinedFamilyProfile, type ProfileConfig } from '../config/types.ts';
import { validateFamilyDefinition } from '../config/family-profile.ts';
import type { DefinedTestFamily } from '../engine/test-family.ts';
import { bindFrozenFamilyDefinition, resolveModuleFamily } from './family-resolution.ts';
import { recordedIntegrationExecutionSchema } from './replay-profile.ts';
import { familyValueSchema } from './family-transport-schema.ts';

const recordedFamilyPolicySchema = normalizedMicrotestProfileSchema.omit({ coverage: true, testFamily: true }).extend({
    settings: familyValueSchema,
    files: normalizedMicrotestProfileSchema.shape.files.unwrap(),
    execution: z.union([ normalizedMicrotestProfileSchema.shape.execution, recordedIntegrationExecutionSchema ])
});

const recordedFamilyProfileSchema = z.strictObject({
    kind: z.literal('family'),
    family: z.strictObject({
        id: z.string().min(1),
        version: z.string().min(1),
        module: z.strictObject({ moduleUrl: z.url(), exportName: z.string().min(1) }).nullable()
    }),
    policy: z.record(z.string(), z.unknown())
});

export function isRecordedFamilyProfile(value: unknown): boolean {
    return typeof value === 'object' && value !== null && Reflect.get(value, 'kind') === 'family';
}

type RecordedFamilyProfile = Readonly<z.output<typeof recordedFamilyProfileSchema>>;

function configuredReplayFamily(saved: RecordedFamilyProfile, current: ProfileConfig): DefinedTestFamily {
    if (typeof current.testFamily === 'string') {
        throw new TypeError('Recorded family configuration changed; collect a new run.');
    }
    if (!isDeepStrictEqual(current.settings, Reflect.get(saved.policy, 'settings'))) {
        throw new TypeError('Recorded family configuration settings changed; collect a new run.');
    }
    return current.testFamily;
}

async function resolveRecordedFamily(
    saved: RecordedFamilyProfile,
    current: ProfileConfig | undefined
): Promise<DefinedTestFamily> {
    if (current !== undefined) {
        return configuredReplayFamily(saved, current);
    }
    if (saved.family.module === null) {
        throw new TypeError('Recorded family requires an explicit compatible configuration.');
    }
    return await resolveModuleFamily({ kind: 'module', module: saved.family.module }, {
        async importModule(moduleUrl) {
            const namespace: unknown = await import(moduleUrl);
            return namespace;
        }
    });
}

export async function restoreFamilyReplayProfile(
    value: unknown,
    current: ProfileConfig | undefined
): Promise<DefinedFamilyProfile> {
    const saved = recordedFamilyProfileSchema.parse(value);
    const family = await resolveRecordedFamily(saved, current);
    const policy = recordedFamilyPolicySchema.parse(saved.policy);
    const binding = bindFrozenFamilyDefinition(
        { ...saved.family, settings: policy.settings },
        family,
        policy.execution.processModel
    );
    const profile: DefinedFamilyProfile = {
        ...policy,
        testFamily: family,
        settings: binding.settings,
        [familySettings]: binding,
        reporters: current?.reporters ?? null
    };
    validateFamilyDefinition(profile);
    return profile;
}
