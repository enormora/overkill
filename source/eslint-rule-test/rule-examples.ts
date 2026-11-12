import type { RuleTester } from 'eslint';
import { z } from 'zod';
import { executeValidExample, executeInvalidExample } from './example-execution.ts';
import { errorExpectations } from './diagnostic-expectations.ts';
import { mergeConfig, selectConfigs } from './configuration-selection.ts';
import type {
    ConfiguredExample,
    ESLintTestConfig,
    NativeRuleDefinition,
    RuleConfiguration
} from './rule-definition.ts';

function caseSelection(value: Readonly<Record<string, unknown>>): unknown {
    return Object.hasOwn(value, 'configs') ? Reflect.get(value, 'configs') : null;
}

function checkFields(value: Readonly<Record<string, unknown>>): void {
    const allowed = new Set([
        'code',
        'name',
        'configs',
        'options',
        'filename',
        'languageOptions',
        'settings',
        'errors',
        'output',
        'processor',
        'language'
    ]);
    for (const key of Object.keys(value)) {
        if (!allowed.has(key)) {
            throw new TypeError(`Unsupported rule case field ${key}.`);
        }
    }
    z.object({ code: z.string(), options: z.array(z.unknown()).optional(), filename: z.string().optional() }).parse(
        value
    );
}

function checkValidCase(value: Readonly<Record<string, unknown>>): void {
    checkFields(value);
    if (Object.hasOwn(value, 'errors') || Object.hasOwn(value, 'output')) {
        throw new TypeError('Valid cases must not contain error or fix expectations.');
    }
}

function checkInvalidCase(value: Readonly<Record<string, unknown>>): void {
    checkFields(value);
    z
        .object({
            errors: errorExpectations,
            output: z.union([ z.string(), z.null() ]).optional()
        })
        .parse(value);
    if (value.output === value.code) {
        throw new TypeError('Use null or omit output when no fix is expected.');
    }
}

function configuredValue<Value extends RuleTester.ValidTestCase>(value: Value, config: ESLintTestConfig): Value {
    return { ...value, ...mergeConfig(config, value), options: structuredClone(value.options ?? []) };
}

function exampleEntry(
    title: string,
    configuration: RuleConfiguration,
    value: RuleTester.ValidTestCase,
    run: () => void
): ConfiguredExample {
    return { title, configName: configuration.name, config: mergeConfig(configuration.config, value), value, run };
}

function matchingConfigurations(
    configurations: readonly RuleConfiguration[],
    names: readonly string[]
): readonly RuleConfiguration[] {
    return names.map(function named(name) {
        const configuration = configurations.find(function matches(value) {
            return value.name === name;
        });
        if (configuration === undefined) {
            throw new TypeError(`Missing configuration ${name}.`);
        }
        return configuration;
    });
}

export function validExamples<Name extends string>(
    definition: NativeRuleDefinition<Name>,
    configurations: readonly RuleConfiguration[],
    defaults: readonly string[]
): readonly ConfiguredExample[] {
    return definition.valid.flatMap(function validCase(input, index) {
        const raw = typeof input === 'string' ? { code: input } : input;
        checkValidCase(raw);
        const { configs: selection, ...example } = { ...raw, configs: caseSelection(raw) };
        const names = selection === null ? defaults : selectConfigs(definition.configs, selection);
        return matchingConfigurations(configurations, names).map(function expand(configuration) {
            const value = configuredValue(example, configuration.config);
            return exampleEntry(`valid ${index + 1}: ${configuration.name}`, configuration, value, function run() {
                executeValidExample(definition.rule, value, configuration.config);
            });
        });
    });
}

export function invalidExamples<Name extends string>(
    definition: NativeRuleDefinition<Name>,
    configurations: readonly RuleConfiguration[],
    defaults: readonly string[]
): readonly ConfiguredExample[] {
    return definition.invalid.flatMap(function invalidCase(raw, index) {
        checkInvalidCase(raw);
        const { configs: selection, ...example } = { ...raw, configs: caseSelection(raw) };
        const names = selection === null ? defaults : selectConfigs(definition.configs, selection);
        return matchingConfigurations(configurations, names).map(function expand(configuration) {
            const value = {
                ...configuredValue(example, configuration.config),
                errors: structuredClone(example.errors)
            };
            return exampleEntry(`invalid ${index + 1}: ${configuration.name}`, configuration, value, function run() {
                executeInvalidExample(definition.rule, value, configuration.config);
            });
        });
    });
}
