import { z } from 'zod';
import type { JsonValue, ReadonlyDeep } from 'type-fest';

const adapterFactsSchema: z.ZodType<ReadonlyDeep<JsonValue>> = z.lazy(function () {
    return z.union([
        z.null(),
        z.string(),
        z.boolean(),
        z.number(),
        z.array(adapterFactsSchema).readonly(),
        z.record(z.string(), adapterFactsSchema).readonly()
    ]);
});

export function parseAdapterFacts(value: unknown): ReadonlyDeep<JsonValue> {
    return adapterFactsSchema.parse(value);
}
