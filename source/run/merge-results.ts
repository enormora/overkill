import { ulid } from 'ulid';
import { createClock } from '@enormora/clock';
import type { MergedRecordOutcome } from './merged-record-session.ts';
import { assessMergeSources } from './merge-results-assessment.ts';
import { serializeRunDiagnostics } from './run-record-result.ts';
import { mergedRunResult } from './merged-run-result.ts';
import type { MergeResultsCommand, MergedRunRecord } from './merge-results-types.ts';

async function aggregateMergeResults(command: MergeResultsCommand): Promise<MergedRunRecord> {
    const started = new Date(createClock().currentUnixEpochMilliseconds);
    const startedAt = started.toISOString();
    const { readMergeSources } = await import('./merge-results-input.ts');
    const { sources, errors } = assessMergeSources(await readMergeSources(command));
    const result = mergedRunResult(sources);
    const diagnostics = serializeRunDiagnostics({ artifacts: [], perTest: [], runnerErrors: errors });
    const [ first, ...remaining ] = sources;
    const { record } = first;
    return {
        id: ulid(),
        kind: 'merged',
        version: 2,
        status: 'started',
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
        result: {
            ...result,
            runnerErrors: [ ...result.runnerErrors, ...diagnostics.runnerErrors ],
            status: errors.length > 0 ? 'failed' : result.status
        }
    };
}

export async function executeMergeResults(command: MergeResultsCommand): Promise<MergedRecordOutcome> {
    const { executeMergedRecord } = await import('./merged-record-session.ts');
    return await executeMergedRecord(command, await aggregateMergeResults(command));
}

export async function mergeResults(command: MergeResultsCommand): Promise<MergedRunRecord> {
    const outcome = await executeMergeResults(command);
    return outcome.record;
}
