import type { Rule } from 'eslint';
import { z } from 'zod';
import type { TestScope } from '../packages/engine/engine.entry-point.ts';
import { sampleGenerator } from '../packages/property/property.entry-point.ts';
import { suite, test } from '../packages/test/test.entry-point.ts';
import { optionInputs } from './option-schemas.ts';
import { schemaGenerator } from './schema-generator.ts';

type RuleSchema = NonNullable<Rule.RuleMetaData['schema']>;
type OptionSchema = Exclude<RuleSchema, readonly unknown[] | false>;
type SchemaContract = {
    readonly title: string;
    readonly schema: OptionSchema;
    readonly expected: z.ZodType;
};
const request = { seed: 42n, count: 24, size: 6, depth: 4 };

function sampleOptions(schema: RuleSchema): readonly (readonly unknown[])[] {
    return sampleGenerator(
        optionInputs({
            meta: { schema },
            create() {
                return {};
            }
        }),
        request
    );
}

const contracts: readonly SchemaContract[] = [
    {
        title: 'integer options exclude exclusive boundaries',
        schema: { type: 'integer', minimum: 1, maximum: 5, exclusiveMinimum: true, exclusiveMaximum: true },
        expected: z.number().int().gt(1).lt(5)
    },
    {
        title: 'number options preserve fractional multiples and exclusive boundaries',
        schema: {
            type: 'number',
            minimum: -1,
            maximum: 2,
            multipleOf: 0.5,
            exclusiveMinimum: true,
            exclusiveMaximum: true
        },
        expected: z.number().gt(-1).lt(2).multipleOf(0.5)
    },
    {
        title: 'unbounded numeric options remain finite',
        schema: { type: 'number' },
        expected: z.number().min(-1000).max(1000)
    },
    {
        title: 'numeric windows extend above an explicit minimum',
        schema: { type: 'number', minimum: 2000 },
        expected: z.number().min(2000).max(3000)
    },
    {
        title: 'numeric windows extend below an explicit maximum',
        schema: { type: 'number', maximum: -2000 },
        expected: z.number().min(-3000).max(-2000)
    },
    {
        title: 'string options respect explicit character bounds',
        schema: { type: 'string', minLength: 2, maxLength: 4 },
        expected: z.string().refine(function bounded(value) {
            const { length } = Array.from(value);
            return length >= 2 && length <= 4;
        })
    },
    {
        title: 'string options support omitted length constraints',
        schema: { type: 'string' },
        expected: z.string()
    },
    {
        title: 'type unions generate only their declared alternatives',
        schema: { type: [ 'null', 'boolean' ] },
        expected: z.union([ z.null(), z.boolean() ])
    },
    {
        title: 'anyOf options satisfy a declared alternative',
        schema: { anyOf: [ { type: 'null' }, { enum: [ 'on', 'off' ] } ] },
        expected: z.union([ z.null(), z.enum([ 'on', 'off' ]) ])
    },
    {
        title: 'oneOf options preserve disjoint alternatives',
        schema: { oneOf: [ { type: 'integer', minimum: 1, maximum: 2 }, { enum: [ 'off' ] } ] },
        expected: z.union([ z.number().int().min(1).max(2), z.literal('off') ])
    },
    {
        title: 'allOf options satisfy every intersecting constraint',
        schema: { allOf: [ { type: 'integer', minimum: 4, maximum: 8 }, { enum: [ 2, 4, 6, 8 ] } ] },
        expected: z.union([ z.literal(4), z.literal(6), z.literal(8) ])
    },
    {
        title: 'tuples constrain additional elements with their schema',
        schema: {
            type: 'array',
            items: [ { enum: [ 1 ] } ],
            additionalItems: { type: 'boolean' },
            minItems: 3,
            maxItems: 3
        },
        expected: z.tuple([ z.literal(1), z.boolean(), z.boolean() ])
    },
    {
        title: 'closed tuples contain only permitted prefixes',
        schema: {
            type: 'array',
            items: [ { enum: [ 1 ] }, { enum: [ 'named' ] } ],
            additionalItems: false,
            maxItems: 5
        },
        expected: z.union([ z.tuple([]), z.tuple([ z.literal(1) ]), z.tuple([ z.literal(1), z.literal('named') ]) ])
    },
    {
        title: 'arrays without item schemas contain JSON values within their bounds',
        schema: { type: 'array', minItems: 1, maxItems: 3 },
        expected: z.array(z.json()).min(1).max(3)
    },
    {
        title: 'objects preserve required and optional fields without additional properties',
        schema: {
            type: 'object',
            properties: { enabled: { type: 'boolean' }, count: { type: 'integer', minimum: 1, maximum: 2 } },
            required: [ 'enabled' ],
            additionalProperties: false
        },
        expected: z.union([
            z.strictObject({ enabled: z.boolean() }),
            z.strictObject({ enabled: z.boolean(), count: z.number().int().min(1).max(2) })
        ])
    },
    {
        title: 'required object fields work without property definitions',
        schema: { type: 'object', required: [ 'value' ] },
        expected: z.object({ value: z.json() })
    },
    {
        title: 'objects support omitted field constraints',
        schema: { type: 'object' },
        expected: z.record(z.string(), z.json())
    },
    {
        title: 'schema annotations do not narrow boolean options',
        schema: {
            type: 'boolean',
            title: 'Enabled',
            description: 'Enable the rule',
            default: true,
            examples: [ true ]
        },
        expected: z.boolean()
    }
];

type Tree = readonly Tree[] | null;
const tree: z.ZodType<Tree> = z.lazy(function recursiveTree() {
    return z.union([ z.null(), z.array(tree).max(1) ]);
});

export const testNode = suite('ESLint option schema contracts', [
    test('array minima extend the default maximum when necessary', function (scope) {
        const generator = optionInputs({
            meta: {
                schema: {
                    type: 'array',
                    items: { type: 'array', items: { type: 'null' }, minItems: 10 },
                    minItems: 1,
                    maxItems: 1
                }
            },
            create() {
                return {};
            }
        });
        const values = sampleGenerator(generator, { ...request, size: 24 });
        scope.assert.equal(values.length, request.count);
        scope.assert.true(values.every(function valid(options) {
            return options.length === 1 && z.array(z.null()).length(10).safeParse(options[0]).success;
        }));
        return scope.assert.collect();
    }),
    test('rejects empty schema choices and unsupported references before sampling', function (scope) {
        const cases = [
            { schema: { enum: [] }, message: 'Schema enum must not be empty.' },
            { schema: { anyOf: [] }, message: 'Schema alternatives must not be empty.' },
            {
                schema: { $ref: 'https://example.com/schema' },
                message: 'Only local schema references are supported; supply generation.input.'
            },
            { schema: { $ref: 42 }, message: 'Only local schema references are supported; supply generation.input.' }
        ];
        for (const { schema, message } of cases) {
            scope.assert.throws(function invalidSchema() {
                schemaGenerator(schema, schema, []);
            }, { message });
        }
        return scope.assert.collect();
    }),
    ...contracts.map(function contract({ title, schema, expected }) {
        return test(title, function (scope) {
            const values = sampleOptions({ type: 'array', items: schema, minItems: 1, maxItems: 1 });
            scope.assert.equal(values.length, request.count);
            scope.assert.true(values.every(function matches(options) {
                return options.length === 1 && expected.safeParse(options[0]).success;
            }));
            return scope.assert.collect();
        });
    }),
    test('rules without option schemas generate empty option lists', function (scope) {
        const values = sampleGenerator(
            optionInputs({
                create() {
                    return {};
                }
            }),
            request
        );
        scope.assert.deepEqual(
            values,
            Array.from({ length: request.count }, function empty() {
                return [];
            })
        );
        return scope.assert.collect();
    }),
    test('schema false permits arbitrary JSON option lists', function (scope) {
        const values = sampleOptions(false);
        scope.assert.equal(values.length, request.count);
        scope.assert.true(values.every(function valid(options) {
            return z.array(z.json()).max(5).safeParse(options).success;
        }));
        scope.assert.true(values.some(function populated(options) {
            return options.length > 0;
        }));
        return scope.assert.collect();
    }),
    test('structured enum values are independent fresh inputs', function (scope: TestScope) {
        const original = { values: [ 1 ] };
        const values = sampleOptions({ type: 'array', items: { enum: [ original ] }, minItems: 1, maxItems: 1 });
        const first = values[0]?.[0];
        scope.require.defined(first);
        if (typeof first !== 'object') {
            throw new TypeError('Expected the enum object.');
        }
        Reflect.set(first, 'values', [ 99 ]);
        scope.assert.deepEqual(original, { values: [ 1 ] });
        scope.assert.deepEqual(values[1]?.[0], { values: [ 1 ] });
        return scope.assert.collect();
    }),
    test('local references decode escaped pointer segments', function (scope) {
        const values = sampleOptions({
            type: 'array',
            items: { $ref: '#/definitions/a~1b~0c' },
            minItems: 1,
            maxItems: 1,
            definitions: { 'a/b~c': { enum: [ 'resolved' ] } }
        });
        scope.assert.deepEqual(
            values,
            Array.from({ length: request.count }, function resolved() {
                return [ 'resolved' ];
            })
        );
        return scope.assert.collect();
    }),
    test('recursive local references remain inside the recursive domain', function (scope) {
        const values = sampleOptions({
            type: 'array',
            items: { $ref: '#/definitions/tree' },
            minItems: 1,
            maxItems: 1,
            definitions: {
                tree: {
                    anyOf: [ { type: 'null' }, { type: 'array', items: { $ref: '#/definitions/tree' }, maxItems: 1 } ]
                }
            }
        });
        scope.assert.equal(values.length, request.count);
        scope.assert.true(values.every(function valid(options) {
            return tree.safeParse(options[0]).success;
        }));
        return scope.assert.collect();
    })
]);
