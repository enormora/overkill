import assert from 'node:assert/strict';
import type { Linter, Rule, RuleTester } from 'eslint';

import { z } from 'zod';

type ExpectedError = Readonly<RuleTester.TestCaseError> | RegExp | string;
type ActualSuggestion = Readonly<NonNullable<Linter.LintMessage['suggestions']>[number]>;

function expectedMessage(rule: Rule.RuleModule, messageId: string, data: Readonly<Record<string, unknown>>): string {
    const template = rule.meta?.messages?.[messageId];
    assert.equal(typeof template, 'string', `Unknown rule messageId ${messageId}.`);
    assert.ok(template !== undefined);
    return template.replaceAll(/\{\{(?<key>[^{}]*)\}\}/gu, function interpolate(match: string, raw: string) {
        const key = raw.trim();
        return Object.hasOwn(data, key) ? String(data[key]) : match;
    });
}

function messageMatches(actual: string, expected: RegExp | string): void {
    if (expected instanceof RegExp) {
        assert.match(actual, new RegExp(expected.source, expected.flags));
    } else {
        assert.equal(actual, expected);
    }
}

function errorMessage(
    rule: Rule.RuleModule,
    actual: Readonly<Linter.LintMessage>,
    expected: Readonly<RuleTester.TestCaseError>
): void {
    assert.ok(
        expected.message === undefined || expected.messageId === undefined,
        'Use message or messageId, not both.'
    );
    if (expected.message !== undefined) {
        messageMatches(actual.message, expected.message);
    }
    if (expected.messageId !== undefined) {
        assert.equal(actual.messageId, expected.messageId);
    }
    if (expected.data !== undefined) {
        assert.ok(expected.messageId !== undefined, 'Message data requires messageId.');
        assert.equal(actual.message, expectedMessage(rule, expected.messageId, expected.data));
    }
}

function errorLocation(actual: Linter.LintMessage, expected: Readonly<RuleTester.TestCaseError>): void {
    const fields = [ 'line', 'column', 'endLine', 'endColumn' ] as const;
    for (const field of fields) {
        if (expected[field] !== undefined) {
            assert.equal(actual[field], expected[field], `Diagnostic ${field} differs.`);
        }
    }
}

export function checkError(rule: Rule.RuleModule, actual: Linter.LintMessage, expected: ExpectedError): void {
    if (typeof expected === 'string' || expected instanceof RegExp) {
        messageMatches(actual.message, expected);
        return;
    }
    errorMessage(rule, actual, expected);
    errorLocation(actual, expected);
}

export function checkSuggestionMessage(
    rule: Rule.RuleModule,
    actual: ActualSuggestion,
    expected: Readonly<RuleTester.SuggestionOutput>
): void {
    assert.ok(expected.desc === undefined || expected.messageId === undefined, 'Use desc or messageId, not both.');
    assert.ok(
        expected.desc !== undefined || expected.messageId !== undefined,
        'A suggestion requires desc or messageId.'
    );
    if (expected.desc !== undefined) {
        assert.equal(actual.desc, expected.desc);
    }
    if (expected.messageId !== undefined) {
        assert.equal(actual.messageId, expected.messageId);
        if (expected.data !== undefined) {
            assert.equal(actual.desc, expectedMessage(rule, expected.messageId, expected.data));
        }
    }
}

const suggestionExpectation = z
    .strictObject({
        desc: z.string().optional(),
        messageId: z.string().optional(),
        data: z.record(z.string(), z.unknown()).optional(),
        output: z.string()
    })
    .refine(function message(value) {
        return value.desc !== undefined || value.messageId !== undefined;
    }, 'A suggestion requires desc or messageId.');
const location = z.number().int().nonnegative().optional();
const errorExpectation = z.strictObject({
    message: z.union([ z.string(), z.instanceof(RegExp) ]).optional(),
    messageId: z.string().optional(),
    data: z.record(z.string(), z.unknown()).optional(),
    line: location,
    column: location,
    endLine: location,
    endColumn: location,
    suggestions: z.union([ z.number().int().nonnegative(), z.array(suggestionExpectation) ]).optional()
});
export const errorExpectations = z.union([
    z.number().int().positive(),
    z.array(z.union([ z.string(), z.instanceof(RegExp), errorExpectation ])).min(1)
]);
