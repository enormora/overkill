import { z } from 'zod';
import type { Linter, Rule } from 'eslint';

import { isGenerator, type Generator as PropertyGenerator } from '../packages/property/property.entry-point.ts';
import type { ESLintTestConfig, RuleGeneration, RuleInput } from './rule-definition.ts';

const stringNames = z.array(z.string()).min(1);

function selectedNames(configs: Readonly<Record<string, ESLintTestConfig>>, selection: unknown): readonly string[] {
    if (selection === 'base') {
        return [ 'base' ];
    }
    if (selection === 'all') {
        return Object.keys(configs).length === 0 ? [ 'base' ] : Object.keys(configs);
    }
    return stringNames.parse(selection);
}

export function selectConfigs(
    configs: Readonly<Record<string, ESLintTestConfig>>,
    selection: unknown
): readonly string[] {
    const names = selectedNames(configs, selection);
    const unique = new Set(names);
    if (
        unique.size !== names.length || names.some(function unknownConfig(name) {
            return name !== 'base' && !Object.hasOwn(configs, name);
        })
    ) {
        throw new TypeError('Configuration selection must contain unique known names.');
    }
    return names;
}

export function linterConfig(config: ESLintTestConfig): Linter.Config {
    return {
        files: [ '**/*.*' ],
        ...config.language === undefined ? {} : { language: config.language },
        ...config.processor === undefined ? {} : { processor: config.processor },
        languageOptions: config.languageOptions ?? {},
        settings: config.settings ?? {}
    };
}

export function subjectConfig(rule: Rule.RuleModule, options: readonly unknown[]): Linter.Config {
    return { plugins: { subject: { rules: { rule } } }, rules: { 'subject/rule': [ 'error', ...options ] } };
}

export function readInputGenerator(value: unknown): PropertyGenerator<RuleInput> {
    if (!isGenerator(value)) {
        throw new TypeError('generation.input must be an Overkill generator.');
    }
    return value.map(function validateInput(input): RuleInput {
        return z.object({ code: z.string(), options: z.array(z.unknown()) }).parse(input);
    });
}

export function configuredGeneration(
    value: Readonly<Record<string, unknown>>,
    fallback: RuleGeneration
): RuleGeneration {
    if (!Object.hasOwn(value, 'generation')) {
        return fallback;
    }
    const generation: unknown = Reflect.get(value, 'generation');
    const parsed = z
        .object({
            syntax: z.enum([ 'javascript', 'typescript' ]),
            filename: z.string().min(1),
            convergence: z.discriminatedUnion('kind', [
                z.object({ kind: z.literal('disabled') }),
                z.object({
                    kind: z.literal('bounded'),
                    maxPasses: z
                        .number()
                        .int()
                        .positive()
                        .max(Number.MAX_SAFE_INTEGER)
                })
            ])
        })
        .parse(generation);
    if (typeof generation !== 'object' || generation === null || !Object.hasOwn(generation, 'input')) {
        return parsed;
    }
    const input: unknown = Reflect.get(generation, 'input');
    return { ...parsed, input: readInputGenerator(input) };
}
