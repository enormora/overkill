import assert from 'node:assert/strict';
import { Linter, type Rule, type RuleTester } from 'eslint';
import { applyRuleFixes, applyRuleEdits } from './rule-fixes.ts';
import { mergeConfig } from './configuration-selection.ts';
import { checkError, checkSuggestionMessage } from './diagnostic-expectations.ts';
import type { ESLintTestConfig } from './rule-definition.ts';

type Example = Readonly<RuleTester.ValidTestCase>;
type ActualSuggestion = Readonly<NonNullable<Linter.LintMessage['suggestions']>[number]>;
type Verification = {
    readonly messages: readonly Linter.LintMessage[];
    readonly parse: (code: string) => readonly Linter.LintMessage[];
};

export function subjectConfig(rule: Rule.RuleModule, options: readonly unknown[]): Linter.Config {
    return { plugins: { subject: { rules: { rule } } }, rules: { 'subject/rule': [ 'error', ...options ] } };
}

function verify(rule: Rule.RuleModule, value: Example, config: ESLintTestConfig): Verification {
    const linter = new Linter();
    const options = { filename: value.filename ?? 'rule-test.js', allowInlineConfig: false };
    const base: Linter.Config = { ...mergeConfig(config, value), files: [ '**/*.*' ] };
    return {
        messages: linter.verify(value.code, [ base, subjectConfig(rule, value.options ?? []) ], options),
        parse(code) {
            return linter.verify(code, [ base ], options);
        }
    };
}

function checkSyntax(code: string, verification: Verification): void {
    assert.ok(
        verification.parse(code).every(function fatal(message) {
            return message.fatal !== true;
        }),
        'A fix produced invalid syntax.'
    );
}

function checkSuggestion(
    rule: Rule.RuleModule,
    input: Example,
    actual: ActualSuggestion,
    expected: Readonly<RuleTester.SuggestionOutput>
): void {
    checkSuggestionMessage(rule, actual, expected);
    assert.equal(applyRuleEdits(input.code, [ actual.fix ]), expected.output, 'Suggestion output differs.');
}

function checkSuggestions(
    rule: Rule.RuleModule,
    input: Example,
    actual: Readonly<Linter.LintMessage>,
    expected: Readonly<RuleTester.TestCaseError>
): void {
    const suggestions = actual.suggestions ?? [];
    const wanted = expected.suggestions ?? 0;
    if (typeof wanted === 'number') {
        assert.equal(suggestions.length, wanted, 'Suggestion count differs.');
        return;
    }
    assert.equal(suggestions.length, wanted.length, 'Suggestion count differs.');
    wanted.forEach(function suggestion(value, index) {
        const observed = suggestions[index];
        assert.ok(observed !== undefined);
        checkSuggestion(rule, input, observed, value);
    });
}

function checkDiagnostics(
    rule: Rule.RuleModule,
    input: Readonly<RuleTester.InvalidTestCase>,
    verification: Verification
): void {
    const expected = input.errors;
    const count = typeof expected === 'number' ? expected : expected.length;
    assert.equal(verification.messages.length, count, 'Diagnostic count differs.');
    if (typeof expected === 'number') {
        return;
    }
    expected.forEach(function diagnostic(value, index) {
        const actual = verification.messages[index];
        assert.ok(actual !== undefined);
        checkError(rule, actual, value);
        if (typeof value === 'object' && !(value instanceof RegExp)) {
            checkSuggestions(rule, input, actual, value);
        }
    });
}

function checkFixes(input: Readonly<RuleTester.InvalidTestCase>, verification: Verification): void {
    const output = applyRuleFixes(input.code, verification.messages);
    assert.equal(output, input.output ?? input.code, 'Autofix output differs.');
    if (output !== input.code) {
        checkSyntax(output, verification);
    }
    for (const message of verification.messages) {
        const suggestions = message.suggestions ?? [];
        for (const suggestion of suggestions) {
            checkSyntax(applyRuleEdits(input.code, [ suggestion.fix ]), verification);
        }
    }
}

export function executeValidExample(rule: Rule.RuleModule, input: Example, config: ESLintTestConfig): void {
    assert.equal(verify(rule, input, config).messages.length, 0, 'Expected no diagnostics.');
}

export function executeInvalidExample(
    rule: Rule.RuleModule,
    input: Readonly<RuleTester.InvalidTestCase>,
    config: ESLintTestConfig
): void {
    const verification = verify(rule, input, config);
    checkDiagnostics(rule, input, verification);
    checkFixes(input, verification);
}
