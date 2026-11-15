import type { Rule } from 'eslint';
import { gen, type Generator as PropertyGenerator } from '../packages/property/property.entry-point.ts';
import { sourceInputs } from './source-inputs.ts';
import { optionInputs } from './option-schemas.ts';
import { readInputGenerator } from './configuration-selection.ts';
import type { ConfiguredExample, RuleConfiguration, RuleInput } from './rule-definition.ts';

export function ruleInputs(
    rule: Rule.RuleModule,
    configuration: RuleConfiguration,
    examples: readonly ConfiguredExample[]
): PropertyGenerator<RuleInput> {
    const { generation } = configuration;
    if (Object.hasOwn(generation, 'input')) {
        return readInputGenerator(Reflect.get(generation, 'input'));
    }
    return gen
        .record({ code: sourceInputs(generation, configuration.config, examples), options: optionInputs(rule) })
        .map(function input(value): RuleInput {
            return value;
        });
}
