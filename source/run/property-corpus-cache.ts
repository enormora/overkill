import { createHash } from 'node:crypto';
import { canonicalJson } from '../canonical-identity.ts';
import { propertyWitnessSchema, type PropertyWitnessFile } from '../engine/witness-file.ts';
import type { PropertyCorpusPolicy } from '../config/types.ts';

type CachedEntry = { readonly id: string; readonly savedAt: string; readonly entry: PropertyWitnessFile; };
export type CorpusDiagnostic = { readonly path: string; readonly reason: string; };
type CacheUpdate = { readonly file: string; readonly policy: PropertyCorpusPolicy; readonly now: string; };
type RetainedCache = {
    readonly entries: readonly CachedEntry[] | null;
    readonly diagnostics: readonly CorpusDiagnostic[];
};
export type CorpusCache = {
    readonly entries: readonly CachedEntry[];
    readonly diagnostics: readonly CorpusDiagnostic[];
};

export function corpusEntryIdentity(entry: PropertyWitnessFile): string {
    return createHash('sha256')
        .update(canonicalJson([ entry.case, entry.runtimes, entry.target, entry.counterexample ]))
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
            const id = corpusEntryIdentity(entry);
            retained.set(id, { id, entry, savedAt: context.now });
        }
    }
    return { entries: Array.from(retained.values()), diagnostics };
}

function cacheBytes(entries: readonly CachedEntry[]): number {
    const references = entries.map(function reference(entry) {
        return { id: entry.id, savedAt: entry.savedAt };
    });
    return Buffer.byteLength(JSON.stringify({
        version: 1,
        entries: references
    })) + entries.reduce(function inputBytes(total, entry) {
        return total + Buffer.byteLength(JSON.stringify(entry.entry));
    }, 0);
}

export function boundedCorpusCache(
    current: CorpusCache,
    entries: readonly PropertyWitnessFile[],
    context: CacheUpdate
): RetainedCache {
    const refreshed = refreshedCache(current, entries, context);
    const ordered = refreshed
        .entries
        .toSorted(function newest(left, right) {
            const time = right.savedAt.localeCompare(left.savedAt);
            return time === 0 ? left.id.localeCompare(right.id) : time;
        })
        .slice(0, context.policy.localCache.maxEntries);
    while (ordered.length > 0 && cacheBytes(ordered) > context.policy.localCache.maxBytes) {
        ordered.pop();
    }
    return cacheBytes(ordered) <= context.policy.localCache.maxBytes
        ? { entries: ordered, diagnostics: refreshed.diagnostics }
        : {
            entries: null,
            diagnostics: [ ...refreshed.diagnostics, {
                path: context.file,
                reason: 'Local corpus byte limit is smaller than its empty envelope.'
            } ]
        };
}
