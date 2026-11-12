import type { Except } from 'type-fest';
import type { Linter, Rule, RuleTester } from 'eslint';
import type { Generator as PropertyGenerator } from '../packages/property/property.entry-point.ts';
import type { Suite } from '../packages/engine/engine.entry-point.ts';
import type { RuleImplementation } from './rule-implementation.ts';

export type ConfigSelection<Name extends string> = readonly [Name, ...Name[]] | 'all' | 'base';
export type RuleInput = { readonly code: string; readonly options: readonly unknown[]; };
type GenerationSettings = {
    readonly syntax: 'javascript' | 'typescript';
    readonly filename: string;
    readonly convergence: { readonly kind: 'bounded'; readonly maxPasses: number; } | { readonly kind: 'disabled'; };
};
type CustomGeneration = GenerationSettings & { readonly input: PropertyGenerator<RuleInput>; };
export type RuleGeneration = CustomGeneration | GenerationSettings;
type LinterConfiguration = Readonly<Pick<Linter.Config, 'language' | 'languageOptions' | 'processor' | 'settings'>>;
type GeneratedConfiguration = LinterConfiguration & { readonly generation: RuleGeneration; };
export type ESLintTestConfig = GeneratedConfiguration | LinterConfiguration;
type ValidExample = Readonly<Except<RuleTester.ValidTestCase, 'after' | 'before' | 'only'>>;
type SelectedValidCase<Name extends string> = ValidExample & { readonly configs: ConfigSelection<Name>; };
export type ValidRuleCase<Name extends string> = SelectedValidCase<Name> | ValidExample | string;
type InvalidExample = Readonly<Except<RuleTester.InvalidTestCase, 'after' | 'before' | 'only'>>;
type SelectedInvalidCase<Name extends string> = InvalidExample & { readonly configs: ConfigSelection<Name>; };
export type InvalidRuleCase<Name extends string> = InvalidExample | SelectedInvalidCase<Name>;
type RuleSettings<Name extends string> = ESLintTestConfig & {
    readonly name: string;
    readonly rule: RuleImplementation;
    readonly configs: Readonly<Record<Name, ESLintTestConfig>>;
    readonly valid: readonly ValidRuleCase<NoInfer<Name>>[];
    readonly invalid: readonly InvalidRuleCase<NoInfer<Name>>[];
};
type SelectedRuleSettings<Name extends string> = RuleSettings<Name> & {
    readonly defaultConfigs: ConfigSelection<NoInfer<Name>>;
};
export type RuleDefinition<Name extends string> = RuleSettings<Name> | SelectedRuleSettings<Name>;
export type NativeRuleDefinition<Name extends string> = Except<RuleDefinition<Name>, 'rule'> & {
    readonly rule: Rule.RuleModule;
};
export type RuleTests = { readonly examples: () => Suite; readonly properties: () => Suite; };
export type ConfiguredExample = {
    readonly title: string;
    readonly configName: string;
    readonly config: ESLintTestConfig;
    readonly value: Readonly<RuleTester.ValidTestCase>;
    readonly run: () => void;
};
export type RuleConfiguration = {
    readonly name: string;
    readonly config: ESLintTestConfig;
    readonly generation: RuleGeneration;
};
