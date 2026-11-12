import { z } from 'zod';
import { deepmergeCustom } from 'deepmerge-ts';

import { isGenerator, type Generator as PropertyGenerator } from '../packages/property/property.entry-point.ts';
import type { ESLintTestConfig, RuleGeneration, RuleInput } from './rule-definition.ts';
import { readSchema } from './schema-input.ts';

const stringNames = z.array(z.string()).min(1);
const mergeRecords = deepmergeCustom({ mergeArrays: false });

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

function foreignFields(config: ESLintTestConfig): Pick<ESLintTestConfig, 'language' | 'processor'> {
    return {
        ...config.language === undefined ? {} : { language: config.language },
        ...config.processor === undefined ? {} : { processor: config.processor }
    };
}

function languageOptions(config: ESLintTestConfig): Readonly<Record<string, unknown>> {
    return config.languageOptions ?? {};
}

function mergeLanguage(base: ESLintTestConfig, overlay: ESLintTestConfig): Readonly<Record<string, unknown>> {
    const first = languageOptions(base);
    const second = languageOptions(overlay);
    return {
        ...first,
        ...second,
        parserOptions: mergeRecords(first.parserOptions ?? {}, second.parserOptions ?? {}),
        globals: { ...readSchema(first.globals ?? {}), ...readSchema(second.globals ?? {}) }
    };
}

export function mergeConfig(base: ESLintTestConfig, overlay: ESLintTestConfig): ESLintTestConfig {
    return {
        ...foreignFields(base),
        ...foreignFields(overlay),
        languageOptions: mergeLanguage(base, overlay),
        settings: mergeRecords(base.settings ?? {}, overlay.settings ?? {})
    };
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
