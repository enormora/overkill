import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { propertyWitnessSchema, type PropertyWitnessFile } from '../engine/property-corpus.ts';
import { cacheSchema, cachedEntrySchema as entrySchema } from './property-corpus-cache.ts';
import { CorpusOperationError, type CorpusRequest } from './corpus-types.ts';

export type CorpusCandidate = { readonly id: string | null; readonly entry: PropertyWitnessFile; };
type CorpusCandidates = { readonly entries: readonly CorpusCandidate[]; readonly diagnostics: readonly string[]; };
async function readSource(request: CorpusRequest): Promise<unknown> {
    try {
        return JSON.parse(await readFile(path.resolve(request.cwd, request.source.path), 'utf8'));
    } catch (error: unknown) {
        throw new CorpusOperationError('Cannot read corpus source.', { cause: error }, 'invalid-source');
    }
}

function selectCache(
    values: readonly unknown[],
    request: CorpusRequest
): CorpusCandidates {
    const diagnostics: string[] = [];
    const entries = values.flatMap(function validated(candidate) {
        const parsed = entrySchema.safeParse(candidate);
        if (parsed.success) {
            return [ parsed.data ];
        }
        diagnostics.push(parsed.error.message);
        return [];
    });
    if (request.source.kind === 'cache-entry') {
        const id = request.source.entryId;
        const selected = entries.filter(function matches(entry) {
            return entry.id === id;
        });
        if (selected.length !== 1) {
            throw new CorpusOperationError('Select exactly one existing cache entry.', { cause: null }, 'selection');
        }
        return { entries: selected, diagnostics: [] };
    }
    return {
        entries: entries.toSorted(function byId(left, right) {
            return left.id.localeCompare(right.id);
        }),
        diagnostics
    };
}

function selectSource(
    data: unknown,
    request: CorpusRequest
): CorpusCandidates {
    const witness = propertyWitnessSchema.safeParse(data);
    if (witness.success && request.source.kind === 'path') {
        return { entries: [ { id: null, entry: witness.data } ], diagnostics: [] };
    }
    const cache = cacheSchema.safeParse(data);
    if (!cache.success) {
        throw new CorpusOperationError(
            'Expected a property witness or corpus cache index.',
            { cause: cache.error },
            'invalid-source'
        );
    }
    return selectCache(cache.data.entries, request);
}

export async function readCorpusEntries(
    request: CorpusRequest
): Promise<CorpusCandidates> {
    const data = await readSource(request);
    return selectSource(data, request);
}
