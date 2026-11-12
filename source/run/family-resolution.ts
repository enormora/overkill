import { isDeepStrictEqual } from 'node:util';
import { builtinTestFamily } from '../engine/builtin-test-families.ts';
import {
    bindFamilySettings,
    isDefinedTestFamily,
    type BoundFamilySettings,
    type DefinedTestFamily
} from '../engine/test-family.ts';
import type { FamilyPreparationFacts } from '../engine/family-run.ts';
import type { NormalizedConfig } from '../config/types.ts';
import type { FamilyResolutionSource, FrozenFamilyDefinition } from './family-catalog.ts';
import { RunCollectionError } from './run-errors.ts';

type FamilyResolutionDependencies = {
    readonly loadConfig: (configPath: string) => Promise<NormalizedConfig>;
    readonly importModule: (moduleUrl: string) => Promise<unknown>;
};

async function resolveConfiguredFamily(
    input: FrozenFamilyDefinition,
    source: Extract<FamilyResolutionSource, { readonly kind: 'config-file'; }>,
    dependencies: FamilyResolutionDependencies
): Promise<DefinedTestFamily> {
    const config = await dependencies.loadConfig(source.configPath);
    const profile = config.profiles[source.profile];
    if (profile === undefined) {
        throw new TypeError('The frozen family profile is unavailable.');
    }
    if (typeof profile.testFamily === 'string') {
        return builtinTestFamily(profile.testFamily);
    }
    if (!isDeepStrictEqual(profile.settings, input.settings)) {
        throw new TypeError('Frozen family configuration settings changed; collect a new run.');
    }
    return profile.testFamily;
}

export async function resolveModuleFamily(
    source: Extract<FamilyResolutionSource, { readonly kind: 'module'; }>,
    dependencies: Pick<FamilyResolutionDependencies, 'importModule'>
): Promise<DefinedTestFamily> {
    const namespace = await dependencies.importModule(source.module.moduleUrl);
    if (typeof namespace !== 'object' || namespace === null || !Object.hasOwn(namespace, source.module.exportName)) {
        throw new TypeError('The frozen family module must contain its named export.');
    }
    const definition: unknown = Reflect.get(namespace, source.module.exportName);
    if (!isDefinedTestFamily(definition)) {
        throw new TypeError('The frozen family export must be a defined test family.');
    }
    return definition;
}

async function resolveDefinition(
    input: FrozenFamilyDefinition,
    dependencies: FamilyResolutionDependencies
): Promise<DefinedTestFamily> {
    const { source } = input;
    if (source.kind === 'builtin') {
        return builtinTestFamily(source.id);
    }
    if (source.kind === 'config-file') {
        return await resolveConfiguredFamily(input, source, dependencies);
    }
    return await resolveModuleFamily(source, dependencies);
}

type FamilyProcessModel = 'in-process' | 'supervised-process' | 'worker-pool';

export function bindFrozenFamilyDefinition(
    input: Pick<FrozenFamilyDefinition, 'id' | 'settings' | 'version'>,
    family: DefinedTestFamily,
    processModel: FamilyProcessModel
): BoundFamilySettings {
    if (family.id !== input.id || family.version !== input.version) {
        throw new TypeError('Frozen family identity or implementation version changed; collect a new run.');
    }
    if (!family.features.processModels.includes(processModel)) {
        throw new TypeError('The frozen family does not support the selected process model.');
    }
    const binding = bindFamilySettings(family, input.settings);
    if (!isDeepStrictEqual(binding.settings, input.settings)) {
        throw new TypeError('Frozen family settings changed; collect a new run.');
    }
    return binding;
}

export async function resolveFrozenFamily(
    input: FrozenFamilyDefinition,
    processModel: 'in-process' | 'supervised-process' | 'worker-pool',
    dependencies: FamilyResolutionDependencies
): Promise<BoundFamilySettings> {
    try {
        const family = await resolveDefinition(input, dependencies);
        return bindFrozenFamilyDefinition(input, family, processModel);
    } catch (error: unknown) {
        throw new RunCollectionError('Failed to resolve the frozen test family.', { cause: error }, 'loader');
    }
}

export function assertFrozenFamilyPreparation(expected: FamilyPreparationFacts, actual: FamilyPreparationFacts): void {
    function snapshot(facts: FamilyPreparationFacts): FamilyPreparationFacts {
        return { id: facts.id, version: facts.version, settings: facts.settings, preparation: facts.preparation };
    }
    if (!isDeepStrictEqual(snapshot(expected), snapshot(actual))) {
        throw new RunCollectionError(
            'Frozen family preparation changed; collect a new run.',
            { cause: null },
            'loader'
        );
    }
}
