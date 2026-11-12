import { z } from 'zod';
import { defineMacro, suite, test } from '../packages/test/test.entry-point.ts';
import { nativeRule } from './rule-implementation.ts';
import { configuredGeneration, mergeConfig, selectConfigs } from './configuration-selection.ts';
import { invalidExamples, validExamples } from './rule-examples.ts';
import { observeRule, ruleCheck } from './rule-observation.ts';
import { propertyNodes } from './rule-properties.ts';
import type {
    ESLintTestConfig,
    RuleConfiguration,
    RuleDefinition,
    RuleGeneration,
    NativeRuleDefinition,
    RuleTests
} from './rule-definition.ts';

const defaultGeneration: RuleGeneration = {
    syntax: 'javascript',
    filename: 'rule-test.js',
    convergence: { kind: 'disabled' }
};

function definitionSelection(value: Readonly<Record<string, unknown>>): unknown {
    return Object.hasOwn(value, 'defaultConfigs') ? Reflect.get(value, 'defaultConfigs') : 'all';
}

function configurationEntries<Name extends string>(definition: RuleDefinition<Name>): readonly RuleConfiguration[] {
    const generation = configuredGeneration(definition, defaultGeneration);
    const named: Readonly<Record<string, ESLintTestConfig>> = definition.configs;
    const entries: readonly (readonly [string, ESLintTestConfig])[] = [ [ 'base', {} ], ...Object.entries(named) ];
    return entries.map(function configuration([ name, overlay ]) {
        return {
            name,
            config: mergeConfig(definition, overlay),
            generation: configuredGeneration(overlay, generation)
        };
    });
}

function validateDefinition(value: Readonly<Record<string, unknown>>): void {
    z
        .object({
            name: z.string().trim().min(1),
            rule: z.object({ create: z.function() }),
            configs: z.record(z.string(), z.object({})),
            valid: z.array(z.unknown()),
            invalid: z.array(z.unknown())
        })
        .parse(value);
    const configs: unknown = Reflect.get(value, 'configs');
    if (typeof configs === 'object' && configs !== null && Object.hasOwn(configs, 'base')) {
        throw new TypeError('The configuration name base is reserved.');
    }
}

export function defineRuleTests<const Name extends string>(input: RuleDefinition<Name>): RuleTests {
    validateDefinition(input);
    const definition: NativeRuleDefinition<Name> = { ...input, rule: nativeRule(input.rule) };
    const configurations = configurationEntries(definition);
    const defaults = selectConfigs(definition.configs, definitionSelection(definition));
    const examples = [
        ...validExamples(definition, configurations, defaults),
        ...invalidExamples(definition, configurations, defaults)
    ];
    const selected = configurations.filter(function reachable(configuration) {
        return defaults.includes(configuration.name) || examples.some(function owns(example) {
            return example.configName === configuration.name;
        });
    });
    return {
        examples: defineMacro(function exampleSuite() {
            return suite(
                definition.name,
                examples.map(function exampleNode(example) {
                    return test(example.title, function checkExample(scope) {
                        scope.assert(ruleCheck, 'ESLint example', observeRule(example.run, scope.signal));
                        return scope.assert.collect();
                    });
                })
            );
        }),
        properties: defineMacro(function propertySuite() {
            return suite(definition.name, propertyNodes(definition.rule, selected, examples));
        })
    };
}
