import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { propertyWitnessSchema, type PropertyWitnessFile } from '../engine/witness-file.ts';
import type { CorpusCache } from './property-corpus-cache.ts';
import { corpusIndexSchema, readCorpusCache } from './property-corpus-storage.ts';
import { CorpusOperationError, type CorpusRequest } from './corpus-types.ts';

export type CorpusCandidate = { readonly id: string | null; readonly entry: PropertyWitnessFile; };
export type CorpusCandidates = {
    readonly entries: readonly CorpusCandidate[];
    readonly diagnostics: readonly string[];
};
async function readSource(request: CorpusRequest, read: (target: string) => Promise<string>): Promise<unknown> {
    try {
        return JSON.parse(await read(path.resolve(request.cwd, request.source.path)));
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
    request: CorpusRequest,
    readCache: CorpusSourceAccess['readCache']
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
    return selectCache(await readCache(path.resolve(request.cwd, request.source.path)), request);
}

export type CorpusSourceAccess = {
    readonly readFile: (target: string) => Promise<string>;
    readonly readCache: (target: string) => Promise<CorpusCache>;
};
export async function loadCorpusEntries(
    request: CorpusRequest,
    access: CorpusSourceAccess
): Promise<CorpusCandidates> {
    const data = await readSource(request, access.readFile);
    return await selectSource(data, request, access.readCache);
}

export async function readCorpusEntries(request: CorpusRequest): Promise<CorpusCandidates> {
    return await loadCorpusEntries(request, {
        readCache: readCorpusCache,
        async readFile(target) {
            return await readFile(target, 'utf8');
        }
    });
}
