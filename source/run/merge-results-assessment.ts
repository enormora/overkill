import type { NonEmptyReadonlyArray } from '../assertion-protocol/assertion-node-shape.ts';
import { workIdentityKey } from '../engine/identity.ts';
import type { RunnerError } from '../engine/run-result.ts';
import { mergeCompatibilityConflicts } from './merge-results-compatibility.ts';
import type { MergeInputRead, MergeSource } from './merge-results-input.ts';
import { RunCollectionError } from './run-errors.ts';

function mergeError(message: string): RunnerError {
    const error = new RunCollectionError(message, {}, 'merge');
    return error.runnerError();
}
function sourceErrors(reference: MergeSource, source: MergeSource): readonly RunnerError[] {
    const { shard } = source.record.facts.reproducibility;
    const errors = mergeCompatibilityConflicts([ reference, source ]).map(function diagnostic(conflict) {
        const advice = conflict.reason === 'missing-evidence'
            ? ' Regenerate shard records with selection evidence.'
            : '';
        const difference = `${conflict.field}: ${conflict.reason} in ${conflict.sourcePath}`;
        const lineage = ` (${source.record.id}) compared with ${conflict.referencePath}.${advice}`;
        return mergeError(difference + lineage);
    });
    if (shard.index > shard.total) {
        errors.push(mergeError(`Invalid shard ${shard.index}/${shard.total} in ${source.path}.`));
    }
    return errors;
}
type MergeAssessment = {
    readonly sources: NonEmptyReadonlyArray<MergeSource>;
    readonly errors: readonly RunnerError[];
};
type MergeIdentity = { readonly key: string; readonly path: string; };
function duplicateErrors(entries: readonly MergeIdentity[], label: string): readonly RunnerError[] {
    const owners = new Map<string, string>();
    return entries.flatMap(function duplicate(entry) {
        const owner = owners.get(entry.key);
        owners.set(entry.key, entry.path);
        return owner === undefined
            ? []
            : [ mergeError(`Duplicate ${label} ${entry.key}: ${owner} and ${entry.path}.`) ];
    });
}
function missingShardErrors(sources: NonEmptyReadonlyArray<MergeSource>): readonly RunnerError[] {
    const indices = new Set(sources.map(function index(source) {
        return source.record.facts.reproducibility.shard.index;
    }));
    const { total } = sources[0].record.facts.reproducibility.shard;
    const errors: RunnerError[] = [];
    for (let index = 1; index <= total; index += 1) {
        if (!indices.has(index)) {
            errors.push(mergeError(`Missing shard ${index}/${total}.`));
        }
    }
    return errors;
}
function coverageErrors(sources: NonEmptyReadonlyArray<MergeSource>): readonly RunnerError[] {
    const shards = sources.map(function shard(source) {
        return { key: String(source.record.facts.reproducibility.shard.index), path: source.path };
    });
    const work = sources.flatMap(function executed(source) {
        return source.record.result.perTest.map(function identity(result) {
            return { key: workIdentityKey(result.workId), path: source.path };
        });
    });
    return [
        ...duplicateErrors(shards, 'shard'),
        ...duplicateErrors(work, 'executed work identity'),
        ...missingShardErrors(sources)
    ];
}
function compatibleSources(input: MergeInputRead): MergeInputRead {
    const errors = Array.from(input.errors);
    const sources: MergeSource[] = [];
    for (const source of input.sources) {
        const conflicts = sourceErrors(sources[0] ?? source, source);
        if (conflicts.length > 0) {
            errors.push(...conflicts);
        } else {
            sources.push(source);
        }
    }
    return { sources, errors };
}
export function assessMergeSources(input: MergeInputRead): MergeAssessment {
    const { sources, errors } = compatibleSources(input);
    const [ first, ...rest ] = sources;
    if (first === undefined) {
        throw new RunCollectionError(
            errors
                .map(function message(error) {
                    return error.message;
                })
                .join('\n'),
            {},
            'merge'
        );
    }
    const admitted: NonEmptyReadonlyArray<MergeSource> = [ first, ...rest ];
    return { sources: admitted, errors: [ ...errors, ...coverageErrors(admitted) ] };
}
