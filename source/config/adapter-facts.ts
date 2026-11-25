import { z } from 'zod';
import type { JsonValue, ReadonlyDeep } from 'type-fest';

const parsedContainers = new WeakSet<object>();

const adapterFactsSchema: z.ZodType<ReadonlyDeep<JsonValue>> = z.lazy(function () {
    return z.union([
        z.null(),
        z.string(),
        z.boolean(),
        z.number(),
        z.custom<ReadonlyDeep<JsonValue>>(function wasParsed(value) {
            return typeof value === 'object' && value !== null && parsedContainers.has(value);
        }),
        z.array(adapterFactsSchema).readonly(),
        z.record(z.string(), adapterFactsSchema).readonly()
    ]);
});

export function parseAdapterFacts(value: unknown): ReadonlyDeep<JsonValue> {
    const facts = adapterFactsSchema.parse(value);
    if (typeof facts === 'object' && facts !== null) {
        parsedContainers.add(facts);
    }
    return facts;
}
