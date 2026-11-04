import { createHash } from 'node:crypto';
import { z } from 'zod/v4';
import { propertyWitnessSchema, type PropertyWitnessFile } from '../engine/property-corpus.ts';
import type { PropertyCorpusPolicy } from '../config/types.ts';

export const cachedEntrySchema = z.strictObject({
    id: z.string().min(1),
    savedAt: z.string(),
    entry: propertyWitnessSchema
});
export const cacheSchema = z.strictObject({ version: z.literal(1), entries: z.array(z.unknown()) });
type CachedEntry = Readonly<z.output<typeof cachedEntrySchema>>;
export type CorpusDiagnostic = { readonly path: string; readonly reason: string; };
type CacheUpdate = { readonly file: string; readonly policy: PropertyCorpusPolicy; readonly now: string; };
type EncodedCache = { readonly content: string | null; readonly diagnostics: readonly CorpusDiagnostic[]; };
export type CorpusCache = {
    readonly entries: readonly CachedEntry[];
    readonly diagnostics: readonly CorpusDiagnostic[];
};

function validatedEntries(candidates: readonly unknown[], file: string): CorpusCache {
    const entries: CachedEntry[] = [];
    const diagnostics: CorpusDiagnostic[] = [];
    for (const candidate of candidates) {
        const parsed = cachedEntrySchema.safeParse(candidate);
        if (parsed.success) {
            entries.push(parsed.data);
        } else {
            diagnostics.push({ path: file, reason: parsed.error.message });
        }
    }
    return { entries, diagnostics };
}

function decodedCache(content: string, file: string): CorpusCache {
    return validatedEntries(cacheSchema.parse(JSON.parse(content)).entries, file);
}

export function parseCorpusCache(content: string | null, file: string): CorpusCache {
    if (content === null) {
        return { entries: [], diagnostics: [] };
    }
    try {
        return decodedCache(content, file);
    } catch (error: unknown) {
        return { entries: [], diagnostics: [ { path: file, reason: String(error) } ] };
    }
}

function entryIdentity(entry: PropertyWitnessFile): string {
    return createHash('sha256')
        .update(JSON.stringify([ entry.case, entry.runtimes, entry.target, entry.counterexample ]))
        .digest('hex');
}

function refreshedCache(
    current: CorpusCache,
    entries: readonly PropertyWitnessFile[],
    context: CacheUpdate
): CorpusCache {
    const retained = new Map(current.entries.map(function pair(entry) {
        return [ entry.id, entry ] as const;
    }));
    const diagnostics = Array.from(current.diagnostics);
    for (const candidate of entries) {
        const entry = propertyWitnessSchema.parse(candidate);
        if (Buffer.byteLength(JSON.stringify(entry)) > context.policy.localCache.maxEntryBytes) {
            diagnostics.push({
                path: context.file,
                reason: 'Confirmed input exceeds the local corpus entry byte limit.'
            });
        } else {
            const id = entryIdentity(entry);
            retained.set(id, { id, entry, savedAt: context.now });
        }
    }
    return { entries: Array.from(retained.values()), diagnostics };
}

function encodeCache(entries: readonly CachedEntry[]): string {
    return JSON.stringify({ version: 1, entries });
}

export function boundedCorpusCache(
    current: CorpusCache,
    entries: readonly PropertyWitnessFile[],
    context: CacheUpdate
): EncodedCache {
    const refreshed = refreshedCache(current, entries, context);
    const ordered = refreshed
        .entries
        .toSorted(function newest(left, right) {
            const time = right.savedAt.localeCompare(left.savedAt);
            return time === 0 ? left.id.localeCompare(right.id) : time;
        })
        .slice(0, context.policy.localCache.maxEntries);
    while (ordered.length > 0 && Buffer.byteLength(encodeCache(ordered)) > context.policy.localCache.maxBytes) {
        ordered.pop();
    }
    const content = encodeCache(ordered);
    return Buffer.byteLength(content) <= context.policy.localCache.maxBytes
        ? { content, diagnostics: refreshed.diagnostics }
        : {
            content: null,
            diagnostics: [ ...refreshed.diagnostics, {
                path: context.file,
                reason: 'Local corpus byte limit is smaller than its empty envelope.'
            } ]
        };
}
