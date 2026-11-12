import { Linter, type Rule } from 'eslint';
import type { AssertionResult, TestCase } from '../packages/engine/engine.entry-point.ts';
import { property, type PropertySampleScope } from '../packages/property/property.entry-point.ts';
import { observeRule, ruleCheck } from './rule-observation.ts';
import { ruleInputs } from './rule-inputs.ts';
import { subjectConfig } from './example-execution.ts';
import { applyRuleFixes, applyRuleEdits } from './rule-fixes.ts';
import type { ConfiguredExample, RuleConfiguration, RuleInput } from './rule-definition.ts';

type Trial = RuleInput & { readonly example: string | null; };
type LintContext = {
    readonly lint: (code: string) => readonly Linter.LintMessage[];
    readonly parse: (code: string) => readonly Linter.LintMessage[];
};

function parserFailure(messages: readonly Linter.LintMessage[]): boolean {
    return messages.some(function fatal(message) {
        return message.fatal === true || message.ruleId === null;
    });
}

function verify(
    code: string,
    config: readonly Linter.Config[],
    options: Readonly<Linter.LintOptions>
): readonly Linter.LintMessage[] {
    const linter = new Linter();
    return linter.verify(code, Array.from(config), options);
}

function lintContext(
    rule: Rule.RuleModule,
    configuration: RuleConfiguration,
    trial: Trial,
    example: ConfiguredExample | undefined
): LintContext {
    const config = example?.config ?? configuration.config;
    const options = {
        filename: example?.value.filename ?? configuration.generation.filename,
        allowInlineConfig: false
    };
    return {
        lint(code) {
            return verify(code, [ { ...config, files: [ '**/*.*' ] }, subjectConfig(rule, trial.options) ], options);
        },
        parse(code) {
            return verify(code, [ { ...config, files: [ '**/*.*' ] } ], options);
        }
    };
}

function checkSyntax(code: string, context: LintContext): void {
    if (parserFailure(context.parse(code))) {
        throw new Error('The rule produced invalid fixed source.');
    }
}

function fixedSyntax(input: RuleInput, context: LintContext): void {
    const messages = context.lint(input.code);
    checkSyntax(applyRuleFixes(input.code, messages), context);
    for (const message of messages) {
        const suggestions = message.suggestions ?? [];
        for (const suggestion of suggestions) {
            checkSyntax(applyRuleEdits(input.code, [ suggestion.fix ]), context);
        }
    }
}

function converges(input: RuleInput, context: LintContext, maxPasses: number, signal: AbortSignal): void {
    let { code } = input;
    for (let pass = 0; pass <= maxPasses; pass += 1) {
        signal.throwIfAborted();
        const output = applyRuleFixes(code, context.lint(code));
        if (output === code) {
            return;
        }
        if (pass === maxPasses) {
            throw new Error(`Autofixes did not converge within ${maxPasses} passes.`);
        }
        checkSyntax(output, context);
        code = output;
    }
}

function checkRule(scope: PropertySampleScope<Trial>, label: string, run: () => void): boolean {
    const observation = observeRule(run, scope.signal);
    if (observation.kind === 'failed') {
        scope.failureKey(label);
    }
    scope.assert(ruleCheck, label, observation);
    return observation.kind === 'passed';
}

type TrialContext = LintContext & {
    readonly configuration: RuleConfiguration;
    readonly example: ConfiguredExample | undefined;
};

function checkFixes(input: Trial, scope: PropertySampleScope<Trial>, context: TrialContext): void {
    if (
        !checkRule(scope, 'Fixes preserve syntax', function fixes() {
            fixedSyntax(input, context);
        })
    ) {
        return;
    }
    const { convergence } = context.configuration.generation;
    if (convergence.kind === 'bounded') {
        checkRule(scope, 'Autofixes converge', function convergenceCheck() {
            converges(input, context, convergence.maxPasses, scope.signal);
        });
    }
}

function checkTrial(input: Trial, scope: PropertySampleScope<Trial>, context: TrialContext): AssertionResult {
    if (context.example !== undefined && !checkRule(scope, 'Exact example', context.example.run)) {
        return scope.assert.collect();
    }
    if (
        !checkRule(scope, 'Rule does not crash', function lint() {
            context.lint(input.code);
        })
    ) {
        return scope.assert.collect();
    }
    if (!parserFailure(context.parse(input.code))) {
        checkFixes(input, scope, context);
    }
    return scope.assert.collect();
}

function propertyNode(
    rule: Rule.RuleModule,
    configuration: RuleConfiguration,
    examples: readonly ConfiguredExample[]
): TestCase {
    const generated = ruleInputs(rule, configuration, examples)
        .filter(function validSource(input) {
            const trial = { ...input, example: null };
            return !parserFailure(lintContext(rule, configuration, trial, undefined).parse(input.code));
        })
        .map(function trial(input): Trial {
            return { ...input, example: null };
        });
    return property({
        title: `generated: ${configuration.name}`,
        generator: generated,
        examples: examples.map(function seed(example) {
            return function original(): Trial {
                return {
                    code: example.value.code,
                    options: structuredClone(example.value.options ?? []),
                    example: example.title
                };
            };
        }),
        test(input, scope) {
            const example = examples.find(function original(value) {
                return value.title === input.example;
            });
            if (input.example !== null && example === undefined) {
                throw new Error('The replayed example no longer exists.');
            }
            const context = {
                ...lintContext(rule, configuration, input, example),
                configuration,
                example
            };
            if (example === undefined && parserFailure(context.parse(input.code))) {
                scope.inconclusive('The generated source is invalid under the current parser configuration.');
            }
            return checkTrial(input, scope, context);
        }
    });
}

export function propertyNodes(
    rule: Rule.RuleModule,
    configurations: readonly RuleConfiguration[],
    examples: readonly ConfiguredExample[]
): readonly TestCase[] {
    return configurations.map(function configuredProperty(configuration) {
        return propertyNode(
            rule,
            configuration,
            examples.filter(function eligible(example) {
                return example.configName === configuration.name;
            })
        );
    });
}
