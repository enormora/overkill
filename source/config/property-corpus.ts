import { z } from 'zod/v4';

const defaults = { maxEntries: 1000, maxBytes: 67_108_864, maxEntryBytes: 1_048_576 };
const limit = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const propertyCorpusPolicySchema = z
    .strictObject({
        checkedIn: z.array(z.string().min(1)).readonly().default([]),
        localCache: z
            .strictObject({
                maxEntries: limit.default(defaults.maxEntries),
                maxBytes: limit.default(defaults.maxBytes),
                maxEntryBytes: limit.default(defaults.maxEntryBytes)
            })
            .readonly()
            .default(defaults)
    })
    .refine(function boundedEntry(policy) {
        return policy.localCache.maxEntryBytes <= policy.localCache.maxBytes;
    })
    .readonly()
    .default({ checkedIn: [], localCache: defaults });
