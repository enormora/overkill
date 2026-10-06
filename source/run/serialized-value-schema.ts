import { z } from 'zod/v4';
import type { SerializedValue } from '../compare/serialized-value.ts';

export const serializedPropertyKeySchema = z.strictObject({ kind: z.enum([ 'string', 'symbol' ]), value: z.string() });
const truncationSchema = z
    .strictObject({
        budget: z.number(),
        reason: z.enum([
            'array-entries',
            'object-entries',
            'depth',
            'serialized-bytes',
            'string-bytes',
            'visited-nodes'
        ])
    })
    .nullable();
const byteFields = { bytes: z.array(z.number()), byteLength: z.number(), truncation: truncationSchema };

export const serializedValueSchema: z.ZodType<SerializedValue> = z.lazy(function () {
    const properties = z.array(z.strictObject({ key: serializedPropertyKeySchema, value: serializedValueSchema }));
    return z.discriminatedUnion('kind', [
        z.strictObject({ kind: z.literal('null') }),
        z.strictObject({ kind: z.literal('undefined') }),
        z.strictObject({ kind: z.literal('boolean'), value: z.boolean() }),
        z.strictObject({ kind: z.literal('bigint'), value: z.string() }),
        z.strictObject({ kind: z.literal('symbol'), value: z.string() }),
        z.strictObject({
            kind: z.literal('number'),
            value: z.union([ z.number(), z.enum([ '-0', '-Infinity', 'Infinity', 'NaN' ]) ])
        }),
        z.strictObject({ kind: z.literal('string'), value: z.string(), truncation: truncationSchema }),
        z.strictObject({ kind: z.literal('function'), id: z.number(), name: z.string().nullable() }),
        z.strictObject({ kind: z.literal('circular'), reference: z.number() }),
        z.strictObject({ kind: z.literal('date'), value: z.string().nullable() }),
        z.strictObject({ kind: z.literal('opaque'), type: z.enum([ 'promise', 'weak-map', 'weak-set' ]) }),
        z.strictObject({ kind: z.literal('regexp'), flags: z.string(), source: z.string() }),
        z.strictObject({ kind: z.literal('unavailable'), reason: z.string() }),
        z.strictObject({
            kind: z.literal('object'),
            constructorName: z.string(),
            entries: properties,
            truncation: truncationSchema
        }),
        z.strictObject({
            kind: z.literal('error'),
            name: z.string(),
            message: z.string(),
            entries: properties,
            truncation: truncationSchema
        }),
        z.strictObject({
            kind: z.literal('array'),
            entries: properties,
            length: z.number(),
            truncation: truncationSchema
        }),
        z.strictObject({
            kind: z.literal('map'),
            entries: z.array(z.strictObject({ key: serializedValueSchema, value: serializedValueSchema })),
            size: z.number(),
            truncation: truncationSchema
        }),
        z.strictObject({
            kind: z.literal('set'),
            size: z.number(),
            values: z.array(serializedValueSchema),
            truncation: truncationSchema
        }),
        z.strictObject({ kind: z.enum([ 'array-buffer', 'data-view' ]), ...byteFields }),
        z.strictObject({
            kind: z.literal('typed-array'),
            constructorName: z.string(),
            length: z.number(),
            ...byteFields
        })
    ]);
});
