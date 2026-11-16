import assert from 'node:assert/strict';
import { z } from 'zod';
import type { Linter } from 'eslint';
import type { ConfigDiagnostics, ConfigFileExpectation } from './config-definition.ts';
import { fatalDiagnostics, type ResolvedConfig } from './config-execution.ts';

function selectedMessages(
    messages: readonly Linter.LintMessage[],
    rules: readonly string[] | 'all'
): readonly Linter.LintMessage[] {
    return rules === 'all' ? messages : messages.filter(function selected(message) {
        return message.ruleId !== null && rules.includes(message.ruleId);
    });
}

function orderedNames<Value extends string | null>(names: Iterable<Value>): readonly Value[] {
    const unique = Array.from(new Set(names));
    return unique.toSorted(function alphabetically(left, right) {
        return String(left).localeCompare(String(right));
    });
}

function checkMessages(
    actual: readonly Linter.LintMessage[],
    expected: Extract<ConfigDiagnostics, { readonly kind: 'messages'; }>
): void {
    assert.equal(actual.length, expected.expected.length, 'Diagnostic count differs.');
    expected.expected.forEach(function check(value, index) {
        const message = actual[index];
        assert.ok(message !== undefined);
        const { message: text, ...fields } = { message: undefined, ...value };
        assert.partialDeepStrictEqual(message, fields);
        if (text instanceof RegExp) {
            assert.match(message.message, new RegExp(text.source, text.flags));
        } else if (text !== undefined) {
            assert.equal(message.message, text);
        }
    });
}

function checkParseFailure(messages: readonly Linter.LintMessage[], expected: RegExp): void {
    const fatal = fatalDiagnostics(messages);
    assert.ok(fatal.length > 0, 'Expected a parser failure.');
    assert.ok(
        fatal.some(function matches(message) {
            const pattern = new RegExp(expected.source, expected.flags);
            return pattern.test(message.message);
        }),
        'Parser failure does not match.'
    );
}

export function checkConfigDiagnostics(messages: readonly Linter.LintMessage[], expected: ConfigDiagnostics): void {
    if (expected.kind === 'parse-failure') {
        checkParseFailure(messages, expected.message);
        return;
    }
    assert.deepEqual(fatalDiagnostics(messages), [], 'Unexpected parser failure.');
    if (expected.kind === 'clean') {
        assert.deepEqual(messages, [], 'Expected no diagnostics.');
    } else if (expected.kind === 'messages') {
        checkMessages(selectedMessages(messages, expected.rules), expected);
    } else {
        const ids = selectedMessages(messages, expected.rules).map(function ruleId(message) {
            return message.ruleId;
        });
        assert.deepEqual(orderedNames(ids), orderedNames(expected.expected));
    }
}

const severityNumbers = { off: 0, warn: 1, error: 2 } as const;
export function normalizedRule(value: unknown): readonly unknown[] {
    const values: readonly unknown[] = Array.isArray(value) ? z.array(z.unknown()).parse(value) : [ value ];
    const severity = values[0];
    const normalized = typeof severity === 'string'
        ? severityNumbers[z.enum([ 'off', 'warn', 'error' ]).parse(severity)]
        : severity;
    return [ normalized, ...values.slice(1) ];
}

function checkRules(
    actual: ResolvedConfig,
    expected: Extract<ConfigFileExpectation, { readonly kind: 'included'; }>
): void {
    const { rules } = actual;
    for (const [ name, value ] of Object.entries(expected.rules)) {
        if (value === null) {
            assert.equal(Object.hasOwn(rules, name), false, `Rule ${name} must be absent.`);
        } else {
            const entry = rules[name];
            assert.ok(entry !== undefined, `Rule ${name} is missing.`);
            assert.deepEqual(normalizedRule(entry), normalizedRule(value), `Rule ${name} differs.`);
        }
    }
    if (expected.ruleMatch === 'exact') {
        const names = Object.keys(expected.rules).filter(function present(name) {
            return expected.rules[name] !== null;
        });
        assert.deepEqual(orderedNames(Object.keys(rules)), orderedNames(names), 'Configured rule names differ.');
    }
}

export function checkResolvedConfig(
    actual: ResolvedConfig,
    expected: Extract<ConfigFileExpectation, { readonly kind: 'included'; }>
): void {
    checkRules(actual, expected);
    const { parser, ...language } = expected.languageOptions;
    if (Object.hasOwn(expected.languageOptions, 'parser')) {
        assert.equal(actual.languageOptions.parser, parser, 'Parser identity differs.');
    }
    assert.partialDeepStrictEqual(actual.languageOptions, language);
    assert.partialDeepStrictEqual(actual.settings, expected.settings);
}
