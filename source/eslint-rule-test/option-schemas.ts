import AjvModule from 'ajv-draft-04';
import { z } from 'zod';
import type { Rule } from 'eslint';
import { gen, type Generator as PropertyGenerator } from '../packages/property/property.entry-point.ts';
import { readSchema, jsonValue } from './schema-input.ts';
import { schemaGenerator } from './schema-generator.ts';

type Schema = Readonly<Record<string, unknown>>;

function normalizedSchema(value: unknown): Schema {
    if (value === undefined) {
        return { type: 'array', maxItems: 0 };
    }
    if (!Array.isArray(value)) {
        return readSchema(value);
    }
    if (value.length === 0) {
        return { type: 'array', maxItems: 0 };
    }
    return { type: 'array', items: value, maxItems: value.length };
}

function jsonValues(): PropertyGenerator<unknown[]> {
    return gen.array(jsonValue(), { minLength: 0, maxLength: 5 });
}

export function optionInputs(rule: Rule.RuleModule): PropertyGenerator<readonly unknown[]> {
    if (rule.meta?.schema === false) {
        return jsonValues().map(function options(values): readonly unknown[] {
            return values;
        });
    }
    const root = normalizedSchema(rule.meta?.schema);
    const Validator = AjvModule.default;
    const instance = new Validator({ strict: false, validateFormats: false });
    const validate = instance.compile(root);
    return schemaGenerator(root, root, [])
        .filter(function valid(value) {
            return validate(value);
        })
        .map(function options(value): readonly unknown[] {
            return z.array(z.unknown()).parse(value);
        });
}
