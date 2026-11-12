import { isDeepStrictEqual } from 'node:util';
import type { NonEmptyReadonlyArray } from '../assertion-protocol/assertion-node-shape.ts';
import { workIdentityKey } from '../engine/identity.ts';
import type { MergeSource } from './merge-results-input.ts';

type MergeCompatibilityField = 'loader' | 'profile' | 'seed' | 'selected-identities' | 'shard-total' | 'versions';
type MergeCompatibilityConflict = {
    readonly field: MergeCompatibilityField;
    readonly referencePath: string;
    readonly sourcePath: string;
    readonly reason: 'invalid-evidence' | 'mismatch' | 'missing-evidence';
};

function selectionKeys(source: MergeSource): ReadonlySet<string> | null {
    const identities = source.record.facts.reproducibility.selectedIdentities;
    return identities === null ? null : new Set(identities.map(workIdentityKey));
}

function overkillVersions(source: MergeSource): Readonly<Record<string, string>> {
    return Object.fromEntries(
        Object.entries(source.record.versions.packages).filter(function overkill([ name ]) {
            return name.startsWith('@overkill-dev/');
        })
    );
}

function compatibilityFacts(source: MergeSource): Readonly<Record<MergeCompatibilityField, unknown>> {
    const { facts, versions } = source.record;
    return {
        profile: [ facts.execution.profile, facts.execution.testFamily ],
        seed: BigInt(facts.reproducibility.seed),
        'shard-total': facts.reproducibility.shard.total,
        'selected-identities': selectionKeys(source),
        loader: facts.loader,
        versions: [ versions.engine, overkillVersions(source) ]
    };
}

function selectionEvidence(source: MergeSource): MergeCompatibilityConflict['reason'] | null {
    const identities = source.record.facts.reproducibility.selectedIdentities;
    if (identities === null) {
        return 'missing-evidence';
    }
    const keys = new Set(identities.map(workIdentityKey));
    const local = [
        ...source.record.identities,
        ...source.record.facts.cases.map(function identity(entry) {
            return entry.workId;
        })
    ];
    const unknownWork = local.some(function unknownIdentity(work) {
        return !keys.has(workIdentityKey(work));
    });
    return keys.size !== identities.length || unknownWork ? 'invalid-evidence' : null;
}

function sourceConflicts(reference: MergeSource, source: MergeSource): readonly MergeCompatibilityConflict[] {
    const expected = compatibilityFacts(reference);
    const actual = compatibilityFacts(source);
    const evidence = selectionEvidence(source);
    const fields: readonly MergeCompatibilityField[] = [
        'profile',
        'seed',
        'shard-total',
        'selected-identities',
        'loader',
        'versions'
    ];
    return fields.flatMap(function compare(field): readonly MergeCompatibilityConflict[] {
        const reason = field === 'selected-identities' ? evidence : null;
        const unavailable = [ expected[field], actual[field] ].includes(null);
        if (reason === null && (unavailable || isDeepStrictEqual(expected[field], actual[field]))) {
            return [];
        }
        return [ { field, referencePath: reference.path, sourcePath: source.path, reason: reason ?? 'mismatch' } ];
    });
}

export function mergeCompatibilityConflicts(
    sources: NonEmptyReadonlyArray<MergeSource>
): readonly MergeCompatibilityConflict[] {
    return sources.flatMap(function compare(source) {
        return sourceConflicts(sources[0], source);
    });
}
