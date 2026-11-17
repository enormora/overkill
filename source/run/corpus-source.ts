import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { propertyWitnessSchema, type PropertyWitnessFile } from '../engine/witness-file.ts';
import type { CorpusCache } from './property-corpus-cache.ts';
import { corpusIndexSchema, readCorpusCache } from './property-corpus-storage.ts';
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
    cache: CorpusCache,
    request: CorpusRequest
): CorpusCandidates {
    const { entries } = cache;
    const diagnostics = cache.diagnostics.map(function message(diagnostic) {
        return diagnostic.reason;
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

async function selectSource(
    data: unknown,
    request: CorpusRequest
): Promise<CorpusCandidates> {
    const witness = propertyWitnessSchema.safeParse(data);
    if (witness.success && request.source.kind === 'path') {
        return { entries: [ { id: null, entry: witness.data } ], diagnostics: [] };
    }
    const cache = corpusIndexSchema.safeParse(data);
    if (!cache.success) {
        throw new CorpusOperationError(
            'Expected a property witness or corpus cache index.',
            { cause: cache.error },
            'invalid-source'
        );
    }
    return selectCache(await readCorpusCache(path.resolve(request.cwd, request.source.path)), request);
}

export async function readCorpusEntries(
    request: CorpusRequest
): Promise<CorpusCandidates> {
    const data = await readSource(request);
    return await selectSource(data, request);
}
