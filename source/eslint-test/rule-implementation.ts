import { z } from 'zod';
import type { Rule } from 'eslint';
import { readSchema } from './schema-input.ts';

type RuleFactory = { readonly create: (context: never) => unknown; };
export type RuleImplementation = RuleFactory | RuleFactory & { readonly meta: unknown; };
type Visitor = (...parameters: readonly unknown[]) => unknown;

function visitor(value: unknown): Visitor {
    if (typeof value !== 'function') {
        throw new TypeError('A rule listener must be a function.');
    }
    return function invoke(...parameters: readonly unknown[]): unknown {
        return Reflect.apply(value, undefined, parameters);
    };
}

function listeners(value: unknown): Rule.RuleListener {
    const entries = Object.entries(readSchema(value)).filter(function present([ , listener ]) {
        return listener !== undefined;
    });
    return Object.fromEntries(entries.map(function entry([ name, listener ]) {
        return [ name, visitor(listener) ];
    }));
}

const schemaValue = z.record(z.string(), z.unknown());
const metadataSchema = z.object({
    type: z.enum([ 'problem', 'suggestion', 'layout' ]).default('problem'),
    messages: z.record(z.string(), z.string()).default({}),
    schema: z.union([ z.literal(false), schemaValue, z.array(schemaValue) ]).default([]),
    fixable: z.enum([ 'code', 'whitespace' ]).optional(),
    hasSuggestions: z.boolean().default(false),
    defaultOptions: z.array(z.unknown()).default([])
});

function ruleMetadata(value: unknown): Rule.RuleMetaData {
    const { fixable, ...meta } = metadataSchema.parse(value);
    return fixable === undefined ? meta : { ...meta, fixable };
}

export function nativeRule(rule: RuleImplementation): Rule.RuleModule {
    const meta = ruleMetadata(Reflect.get(rule, 'meta') ?? {});
    return {
        meta,
        create(context) {
            return listeners(Reflect.apply(rule.create, rule, [ context ]));
        }
    };
}
