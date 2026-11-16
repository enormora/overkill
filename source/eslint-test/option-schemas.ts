import { z } from 'zod';
import { Linter, type Rule } from 'eslint';
import { gen, type Generator as PropertyGenerator } from '../packages/property/property.entry-point.ts';
import { readSchema, jsonValue } from './schema-input.ts';
import { schemaGenerator } from './schema-generator.ts';
import { subjectConfig } from './configuration-selection.ts';

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

function optionValidator(rule: Rule.RuleModule): (options: readonly unknown[]) => boolean {
    const linter = new Linter();
    const schemaRule: Rule.RuleModule = {
        meta: { schema: rule.meta?.schema ?? [], defaultOptions: rule.meta?.defaultOptions ?? [] },
        create() {
            return {};
        }
    };
    return function acceptsOptions(options) {
        try {
            linter.verify('', [ subjectConfig(schemaRule, structuredClone(options)) ]);
            return true;
        } catch (error) {
            if (error instanceof Error && error.message.startsWith('Key "rules": Key "subject/rule":\n')) {
                return false;
            }
            throw error;
        }
    };
}

export function optionInputs(rule: Rule.RuleModule): PropertyGenerator<readonly unknown[]> {
    if (rule.meta?.schema === false) {
        return jsonValues().map(function options(values): readonly unknown[] {
            return values;
        });
    }
    const root = normalizedSchema(rule.meta?.schema);
    const validate = optionValidator(rule);
    validate([]);
    return schemaGenerator(root, root, [])
        .map(function options(value): readonly unknown[] {
            return z.array(z.unknown()).parse(value);
        })
        .filter(validate);
}
