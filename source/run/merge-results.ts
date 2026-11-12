import { ulid } from 'ulid';
import { createClock } from '@enormora/clock';
import { mergeCompatibilityConflicts } from './merge-results-compatibility.ts';
import { RunCollectionError } from './run-errors.ts';
import { mergedRunResult } from './merged-run-result.ts';
import type { MergeResultsCommand, MergedRunRecord } from './merge-results-types.ts';

function validateMergeSources(sources: Parameters<typeof mergeCompatibilityConflicts>[0]): void {
    const conflicts = mergeCompatibilityConflicts(sources);
    if (conflicts.length > 0) {
        const diagnostics = conflicts.map(function diagnostic(conflict) {
            const advice = conflict.reason === 'missing-evidence'
                ? ' Regenerate shard records with selection evidence.'
                : '';
            return `${conflict.field}: ${conflict.reason} in ${conflict.sourcePath}` +
                ` compared with ${conflict.referencePath}.${advice}`;
        });
        throw new RunCollectionError(diagnostics.join('\n'), {}, 'merge');
    }
}

export async function mergeResults(command: MergeResultsCommand): Promise<MergedRunRecord> {
    const started = new Date(createClock().currentUnixEpochMilliseconds);
    const startedAt = started.toISOString();
    const { readMergeSources } = await import('./merge-results-input.ts');
    const sources = await readMergeSources(command);
    validateMergeSources(sources);
    const [ first, ...remaining ] = sources;
    const { record } = first;
    return {
        id: ulid(),
        kind: 'merged',
        startedAt,
        facts: {
            ...record.facts,
            cases: sources.flatMap(function cases(source) {
                return source.record.facts.cases;
            }),
            execution: { ...record.facts.execution, placementPlan: null },
            reproducibility: { ...record.facts.reproducibility, shard: { index: 1, total: 1 } }
        },
        identities: sources.flatMap(function identities(source) {
            return source.record.identities;
        }),
        lineage: [
            { id: record.id, path: first.path },
            ...remaining.map(function lineage(source) {
                return { id: source.record.id, path: source.path };
            })
        ],
        runtime: [
            record.runtime,
            ...remaining.map(function runtime(source) {
                return source.record.runtime;
            })
        ],
        versions: { engine: record.versions.engine, packages: record.versions.packages },
        result: mergedRunResult(sources)
    };
}
