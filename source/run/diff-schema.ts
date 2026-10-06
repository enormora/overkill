import { z } from 'zod/v4';
import type { Diff } from '../diff/diff-shape.ts';
import { serializedPropertyKeySchema, serializedValueSchema } from './serialized-value-schema.ts';

export const diffPathSchema = z.array(z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('byte'), offset: z.number() }),
    z.strictObject({ kind: z.literal('index'), index: z.number() }),
    z.strictObject({ kind: z.enum([ 'map-key', 'map-value' ]), key: serializedValueSchema }),
    z.strictObject({ kind: z.literal('property'), key: serializedPropertyKeySchema }),
    z.strictObject({ kind: z.literal('set-value'), value: serializedValueSchema })
]));
const add = z.strictObject({ operation: z.literal('add'), path: diffPathSchema, value: serializedValueSchema });
const remove = z.strictObject({ operation: z.literal('remove'), path: diffPathSchema, value: serializedValueSchema });
const replace = z.strictObject({
    operation: z.literal('replace'),
    path: diffPathSchema,
    from: serializedValueSchema,
    to: serializedValueSchema
});
const member = z.strictObject({ operation: z.literal('missing-member'), value: serializedValueSchema });

export const diffSchema: z.ZodType<Diff> = z.discriminatedUnion('kind', [
    z.strictObject({
        kind: z.literal('array'),
        operations: z.array(z.union([
            add,
            remove,
            replace,
            member,
            z.strictObject({ operation: z.literal('missing-index'), index: z.number(), value: serializedValueSchema })
        ]))
    }),
    z.strictObject({
        kind: z.literal('map'),
        operations: z.array(z.union([
            add,
            remove,
            replace,
            z.strictObject({
                operation: z.literal('missing-entry'),
                key: serializedValueSchema,
                value: serializedValueSchema
            })
        ]))
    }),
    z.strictObject({
        kind: z.literal('object'),
        operations: z.array(z.union([
            add,
            remove,
            replace,
            z.strictObject({
                operation: z.literal('missing-property'),
                path: diffPathSchema,
                value: serializedValueSchema
            })
        ]))
    }),
    z.strictObject({ kind: z.literal('set'), operations: z.array(z.union([ add, remove, member ])) }),
    z.strictObject({
        kind: z.literal('binary'),
        actualHash: z.string(),
        actualSize: z.number(),
        expectedHash: z.string(),
        expectedSize: z.number(),
        ranges: z.array(
            z.strictObject({ actual: z.array(z.number()), expected: z.array(z.number()), offset: z.number() })
        )
    }),
    z.strictObject({
        kind: z.literal('string'),
        actual: z.string(),
        expected: z.string(),
        hunks: z.array(z.strictObject({
            actualStart: z.number(),
            added: z.array(z.string()),
            expectedStart: z.number(),
            removed: z.array(z.string())
        }))
    }),
    z.strictObject({ kind: z.literal('value'), actual: serializedValueSchema, expected: serializedValueSchema })
]);
