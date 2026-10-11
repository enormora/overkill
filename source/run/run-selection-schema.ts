import { z } from 'zod/v4';
import { caseIdSchema } from '../engine/identity-schema.ts';
import type { RunFilter, RunSelection } from './run-request-types.ts';

const field = z.enum([ 'file', 'owner', 'params', 'suite', 'tag', 'title' ]);

const filterSchema: z.ZodType<RunFilter> = z.lazy(function recursiveFilter() {
    const filters = z.tuple([ filterSchema ]).rest(filterSchema);
    return z.discriminatedUnion('kind', [
        z.strictObject({ kind: z.literal('all'), filters }),
        z.strictObject({ kind: z.literal('any'), filters }),
        z.strictObject({ kind: z.literal('not'), filter: filterSchema }),
        z.strictObject({ kind: z.literal('case-id'), id: caseIdSchema }),
        z.strictObject({ kind: z.literal('contains'), field, value: z.string() }),
        z.strictObject({ kind: z.literal('equals'), field, value: z.string() }),
        z.strictObject({ kind: z.literal('glob'), field, pattern: z.string() }),
        z.strictObject({ kind: z.literal('runtime'), runtime: z.string() }),
        z.strictObject({ kind: z.literal('runtime-variant'), runtime: z.string(), variantId: z.string() }),
        z.strictObject({
            kind: z.literal('runtime-dimension'),
            runtime: z.string(),
            dimension: z.string(),
            value: z.string()
        }),
        z.strictObject({
            kind: z.literal('runtime-scenario'),
            runtime: z.string(),
            scenario: z.string(),
            value: z.string()
        })
    ]);
});

export const runSelectionSchema: z.ZodType<RunSelection> = z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('all') }),
    z.strictObject({ kind: z.literal('filter'), filter: filterSchema })
]);
