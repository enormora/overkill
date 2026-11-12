import { gen, type Generator as PropertyGenerator } from '../packages/property/property.entry-point.ts';
import { readSchema, jsonValue } from './schema-input.ts';
import { collectionSchema } from './schema-collections.ts';

type NumberRange = { readonly min: number; readonly max: number; };
type Schema = Readonly<Record<string, unknown>>;
type Context = {
    readonly root: Schema;
    readonly references: readonly string[];
    readonly build: (schema: Schema, context: Context) => PropertyGenerator<unknown>;
};
const numericWindow = 1000;
const maximumStringLength = 100;
const localReferencePrefix = '#/';
const annotations = new Set([ 'title', 'description', 'default', 'examples', '$schema', 'id', 'definitions' ]);
const constraints = new Set([
    'type',
    'enum',
    'minimum',
    'maximum',
    'exclusiveMinimum',
    'exclusiveMaximum',
    'multipleOf',
    'minLength',
    'maxLength',
    'pattern',
    'items',
    'additionalItems',
    'minItems',
    'maxItems',
    'uniqueItems',
    'properties',
    'required',
    'additionalProperties',
    'minProperties',
    'maxProperties',
    'anyOf',
    'oneOf',
    'allOf',
    'not',
    '$ref'
]);

function validateKeywords(schema: Schema): void {
    for (const key of Object.keys(schema)) {
        if (!annotations.has(key) && !constraints.has(key)) {
            throw new TypeError(`Unsupported option schema keyword ${key}; supply generation.input.`);
        }
    }
}

function scalar(value: unknown): PropertyGenerator<unknown> {
    return gen.constant(null).map(function reconstruct() {
        return structuredClone(value);
    });
}

function choose(values: readonly unknown[], context: Context): PropertyGenerator<unknown> {
    const [ first, ...rest ] = values;
    if (values.length === 0) {
        throw new TypeError('Schema alternatives must not be empty.');
    }
    return gen.choice(
        context.build(readSchema(first), context),
        ...rest.map(function branch(value) {
            return context.build(readSchema(value), context);
        })
    );
}

function reference(schema: Schema, context: Context): PropertyGenerator<unknown> {
    const ref = schema.$ref;
    if (typeof ref !== 'string' || !ref.startsWith('#/')) {
        throw new TypeError('Only local schema references are supported; supply generation.input.');
    }
    if (context.references.includes(ref)) {
        return jsonValue();
    }
    const resolved: unknown = ref.slice(localReferencePrefix.length).split('/').reduce<unknown>(
        function field(value, key) {
            return Reflect.get(readSchema(value), key.replaceAll('~1', '/').replaceAll('~0', '~'));
        },
        context.root
    );
    return context.build(readSchema(resolved), { ...context, references: [ ...context.references, ref ] });
}

function numericBounds(schema: Schema): NumberRange {
    const maximum = typeof schema.maximum === 'number' ? schema.maximum : numericWindow;
    const min = typeof schema.minimum === 'number' ? schema.minimum : Math.min(-numericWindow, maximum - numericWindow);
    const max = typeof schema.maximum === 'number' ? schema.maximum : Math.max(numericWindow, min + numericWindow);
    return { min, max };
}

function numberGenerator(
    schema: Schema,
    bounds: NumberRange
): PropertyGenerator<number> {
    if (typeof schema.multipleOf === 'number' && schema.multipleOf > 0) {
        const factor = schema.multipleOf;
        return gen.integer({ min: Math.ceil(bounds.min / factor), max: Math.floor(bounds.max / factor) }).map(
            function multiple(value) {
                return value * factor;
            }
        );
    }
    if (schema.type === 'integer') {
        return gen.integer({ min: Math.ceil(bounds.min), max: Math.floor(bounds.max) });
    }
    return gen.number(bounds);
}

function numeric(schema: Schema): PropertyGenerator<unknown> {
    const range = numericBounds(schema);
    const offset = schema.type === 'integer'
        ? 1
        : Number.EPSILON * Math.max(1, Math.abs(range.min), Math.abs(range.max));
    const bounds = {
        min: range.min + (schema.exclusiveMinimum === true ? offset : 0),
        max: range.max - (schema.exclusiveMaximum === true ? offset : 0)
    };
    return numberGenerator(schema, bounds).map(function number(value): unknown {
        return value;
    });
}

function stringGenerator(schema: Schema): PropertyGenerator<unknown> {
    return gen
        .string({
            minLength: typeof schema.minLength === 'number' ? schema.minLength : 0,
            maxLength: typeof schema.maxLength === 'number'
                ? schema.maxLength
                : maximumStringLength
        })
        .map(function string(value): unknown {
            return value;
        });
}

function primitive(schema: Schema): PropertyGenerator<unknown> {
    if (schema.type === 'null') {
        return scalar(null);
    }
    if (schema.type === 'boolean') {
        return gen.boolean().map(function boolean(value): unknown {
            return value;
        });
    }
    if (schema.type === 'integer' || schema.type === 'number') {
        return numeric(schema);
    }
    return stringGenerator(schema);
}

function typed(schema: Schema, context: Context): PropertyGenerator<unknown> {
    if (Array.isArray(schema.type)) {
        return choose(
            schema.type.map(function type(value: unknown) {
                return { ...schema, type: value };
            }),
            context
        );
    }
    if (schema.type === 'array' || schema.type === 'object') {
        return collectionSchema(schema, function child(value) {
            return context.build(readSchema(value), context);
        });
    }
    if (schema.type === undefined) {
        return jsonValue();
    }
    return primitive(schema);
}

function enumeration(values: readonly unknown[]): PropertyGenerator<unknown> {
    const [ first, ...rest ] = values;
    if (values.length === 0) {
        throw new TypeError('Schema enum must not be empty.');
    }
    return gen.choice(scalar(first), ...rest.map(scalar));
}

function alternatives(schema: Schema): readonly unknown[] | null {
    const branches: unknown = schema.anyOf ?? schema.oneOf ?? schema.allOf;
    return Array.isArray(branches) ? Array.from<unknown>(branches) : null;
}

function build(schema: Schema, context: Context): PropertyGenerator<unknown> {
    validateKeywords(schema);
    if (schema.$ref !== undefined) {
        return reference(schema, context);
    }
    if (Array.isArray(schema.enum)) {
        return enumeration(Array.from<unknown>(schema.enum));
    }
    const branches = alternatives(schema);
    return branches === null ? typed(schema, context) : choose(branches, context);
}

export function schemaGenerator(
    schema: Schema,
    root: Schema,
    references: readonly string[]
): PropertyGenerator<unknown> {
    return build(schema, { root, references, build });
}
