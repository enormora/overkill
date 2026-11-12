import { isDeepStrictEqual } from 'node:util';
import type { DefinedTestFamily, FamilyValue } from '../engine/test-family.ts';
import type { ProfileConfig } from '../config/types.ts';
import type { RunCollectionSource, RunPolicySource } from './run-types.ts';
import type { FamilyResolutionSource, FrozenFamilyDefinition } from './family-catalog.ts';
import { invalidRequest } from './run-errors.ts';

type FamilyTransportInput = {
    readonly profile: ProfileConfig;
    readonly source: RunCollectionSource;
    readonly profileName: string;
    readonly projectRoot: string;
    readonly definitionLocationCapture: 'disabled' | 'enabled';
};

function configurationSource(source: RunCollectionSource): RunPolicySource {
    if (source.kind === 'direct-entrypoint') {
        return source.configuration;
    }
    return source.kind === 'configured-source' ? source.source : { kind: 'memory' };
}

function definitionSource(
    family: DefinedTestFamily,
    source: RunCollectionSource,
    profile: string
): FamilyResolutionSource | null {
    const configuration = configurationSource(source);
    if (configuration.kind === 'config-file' && configuration.resolvedPath !== null) {
        return { kind: 'config-file', configPath: configuration.resolvedPath, profile };
    }
    if (family.module !== null) {
        return { kind: 'module', module: family.module };
    }
    return null;
}

function recordedDefinition(source: RunCollectionSource): FrozenFamilyDefinition | null {
    return source.kind === 'replay' && source.replay.kind === 'record'
        ? source.replay.plan.family?.definition ?? null
        : null;
}

function validateRecordedDefinition(
    family: DefinedTestFamily,
    settings: FamilyValue,
    frozen: FrozenFamilyDefinition
): void {
    if (family.id !== frozen.id || family.version !== frozen.version || !isDeepStrictEqual(settings, frozen.settings)) {
        invalidRequest('Recorded family implementation or settings changed; collect a new run.');
    }
}

export function snapshotProfileFamily(input: FamilyTransportInput): FrozenFamilyDefinition | null {
    const { profile, source, profileName, projectRoot, definitionLocationCapture } = input;
    if (typeof profile.testFamily === 'string') {
        return null;
    }
    const previous = recordedDefinition(source);
    if (previous !== null) {
        validateRecordedDefinition(profile.testFamily, profile.settings, previous);
        return { ...previous, projectRoot, selection: null };
    }
    const resolution = definitionSource(profile.testFamily, source, profileName);
    return resolution === null ? null : {
        id: profile.testFamily.id,
        version: profile.testFamily.version,
        settings: profile.settings,
        projectRoot,
        processModel: profile.execution.processModel,
        definitionLocationCapture,
        checkpoint: null,
        selection: null,
        source: resolution
    };
}

export function freezeProfileFamily(input: FamilyTransportInput): FrozenFamilyDefinition | null {
    const definition = snapshotProfileFamily(input);
    if (typeof input.profile.testFamily !== 'string' && definition === null) {
        invalidRequest('The selected family has no importable configuration or module for isolated execution.');
    }
    return definition;
}
