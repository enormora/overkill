import { gen, type Generator as PropertyGenerator } from '../packages/property/property.entry-point.ts';
import { jsonValue, readSchema } from './schema-input.ts';

type CollectionBounds = { readonly minLength: number; readonly maxLength: number; };
type Schema = Readonly<Record<string, unknown>>;
const defaultMaximumItems = 8;
type PropertyEntry = { readonly name: string; readonly data: unknown; readonly present: boolean; };
type Build = (value: unknown) => PropertyGenerator<unknown>;

function bounds(schema: Schema): CollectionBounds {
    const minLength = typeof schema.minItems === 'number' ? schema.minItems : 0;
    return {
        minLength,
        maxLength: typeof schema.maxItems === 'number' ? schema.maxItems : Math.max(defaultMaximumItems, minLength)
    };
}

function tuple(schema: Schema, items: readonly unknown[], build: Build): PropertyGenerator<unknown> {
    const elements = items.map(build);
    const { minLength, maxLength } = bounds(schema);
    const limit = schema.additionalItems === false ? Math.min(maxLength, elements.length) : maxLength;
    return gen
        .integer({ min: minLength, max: limit })
        .flatMap(function length(size) {
            const extra = typeof schema.additionalItems === 'object' && schema.additionalItems !== null
                ? build(schema.additionalItems)
                : jsonValue();
            return gen.tuple(...Array.from({ length: size }, function element(_value, index) {
                return elements[index] ?? extra;
            }));
        })
        .map(function tupleValue(value): unknown {
            return value;
        });
}

function array(schema: Schema, build: Build): PropertyGenerator<unknown> {
    if (Array.isArray(schema.items)) {
        return tuple(schema, schema.items, build);
    }
    const element = schema.items === undefined ? jsonValue() : build(schema.items);
    return gen.array(element, bounds(schema)).map(function values(value): unknown {
        return value;
    });
}

function optionalProperty(
    name: string,
    value: PropertyGenerator<unknown>,
    required: readonly unknown[]
): PropertyGenerator<PropertyEntry> {
    if (required.includes(name)) {
        return value.map(function present(data): PropertyEntry {
            return { name, data, present: true };
        });
    }
    return gen.tuple(gen.boolean(), value).map(function entry([ present, data ]): PropertyEntry {
        return { name, data, present };
    });
}

function object(schema: Schema, build: Build): PropertyGenerator<unknown> {
    const properties = readSchema(schema.properties ?? {});
    const required = Array.isArray(schema.required) ? schema.required : [];
    const names = Array.from(
        new Set([
            ...Object.keys(properties),
            ...required.filter(function name(value: unknown): value is string {
                return typeof value === 'string';
            })
        ])
    );
    const fields = Object.fromEntries(names.map(function field(key) {
        return [ key, optionalProperty(key, build(properties[key] ?? {}), required) ];
    }));
    return gen.record(fields).map(function record(value): unknown {
        return Object.fromEntries(
            Object
                .values(value)
                .filter(function included(entry) {
                    return entry.present;
                })
                .map(function property(entry) {
                    return [ entry.name, entry.data ];
                })
        );
    });
}

export function collectionSchema(schema: Schema, build: Build): PropertyGenerator<unknown> {
    return schema.type === 'array' ? array(schema, build) : object(schema, build);
}
