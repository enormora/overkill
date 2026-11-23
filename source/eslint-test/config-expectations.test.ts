import { table, suite, test } from '@overkill-dev/test';
import type { Linter } from 'eslint';
import { subjectAssertion } from '../test-support/assertion-reference-boundary.ts';

import { observeRule, ruleCheck } from './rule-observation.ts';
import {
    checkConfigDiagnostics,
    checkResolvedConfig,
    normalizedRule
} from './config-expectations.ts';
import type { ConfigDiagnostics, ConfigFileExpectation } from './config-definition.ts';
import type { ResolvedConfig } from './config-execution.ts';

const message: Linter.LintMessage = {
    ruleId: 'eqeqeq',
    severity: 2,
    message: 'Use strict equality.',
    line: 1,
    column: 1
};
const fatal: Linter.LintMessage = { ...message, ruleId: null, fatal: true, message: 'Unexpected token.' };
const expectation: Extract<ConfigFileExpectation, { readonly kind: 'included'; }> = {
    kind: 'included',
    rules: { eqeqeq: 'error' },
    ruleMatch: 'exact',
    languageOptions: {},
    settings: {}
};
const actual: ResolvedConfig = { rules: { eqeqeq: [ 2 ] }, languageOptions: {}, settings: {} };
export const testNode = suite('ESLint config expectation evaluation', [
    table({
        title: 'normalizes rule severity',
        cases: [
            { description: 'disabled string', input: 'off', expected: [ 0 ] },
            { description: 'warning string', input: 'warn', expected: [ 1 ] },
            { description: 'error string', input: 'error', expected: [ 2 ] },
            { description: 'numeric warning', input: 1, expected: [ 1 ] },
            { description: 'error with options', input: [ 'error', 'always' ], expected: [ 2, 'always' ] },
            { description: 'empty setting', input: [], expected: [ undefined ] }
        ],
        caseTitle({ description }) {
            return description;
        },
        test(scope) {
            const entry = scope.parameters;

            scope.assert.deepEqual(normalizedRule(entry.input), entry.expected);
            return scope.assert.collect();
        }
    }),
    test('rejects unknown severity names', function (scope) {
        scope.assert.throws(function () {
            normalizedRule('fatal');
        }, { message: /Invalid option: expected one of \\"off\\"\|\\"warn\\"\|\\"error\\"/u });
        return scope.assert.collect();
    }),
    test('accepts matching message fields and text patterns repeatedly', function (scope) {
        scope.assert(
            subjectAssertion(ruleCheck),
            'Configuration matches',
            observeRule(function () {
                const expected: ConfigDiagnostics = {
                    kind: 'messages',
                    rules: 'all',
                    expected: [ { ruleId: 'eqeqeq', message: /strict/gu, line: 1 } ]
                };
                checkConfigDiagnostics([ message ], expected);
                checkConfigDiagnostics([ message ], expected);
                checkConfigDiagnostics([ message ], { ...expected, expected: [ { message: 'Use strict equality.' } ] });
            }, scope.signal)
        );
        return scope.assert.collect();
    }),
    test('filters selected rules and compares unique rule identities', function (scope) {
        scope.assert(
            subjectAssertion(ruleCheck),
            'Configuration matches',
            observeRule(function () {
                checkConfigDiagnostics([ message, message, { ...message, ruleId: null } ], {
                    kind: 'rule-ids',
                    rules: [ 'eqeqeq' ],
                    expected: [ 'eqeqeq' ]
                });
                checkConfigDiagnostics([ message, { ...message, ruleId: 'no-console' } ], {
                    kind: 'rule-ids',
                    rules: 'all',
                    expected: [ 'no-console', 'eqeqeq' ]
                });
                checkConfigDiagnostics([], { kind: 'clean' });
            }, scope.signal)
        );
        return scope.assert.collect();
    }),
    test('detects missing messages and incorrect message content', function (scope) {
        scope.assert.throws(function () {
            checkConfigDiagnostics([], { kind: 'messages', rules: 'all', expected: [ { ruleId: 'eqeqeq' } ] });
        }, { message: /Diagnostic count differs/u });
        scope.assert.throws(function () {
            checkConfigDiagnostics([ message ], {
                kind: 'messages',
                rules: 'all',
                expected: [ { message: 'Different.' } ]
            });
        }, { code: 'ERR_ASSERTION', message: /strictly equal:/u });
        scope.assert.throws(function () {
            checkConfigDiagnostics([ message ], {
                kind: 'messages',
                rules: 'all',
                expected: [ { message: /different/u } ]
            });
        }, { code: 'ERR_ASSERTION', message: /did not match the regular expression \/different\/u/u });
        scope.assert.throws(function () {
            checkConfigDiagnostics([ message ], { kind: 'clean' });
        }, { message: /Expected no diagnostics/u });
        return scope.assert.collect();
    }),
    test('matches fatal parser diagnostics and rejects unrelated diagnostics', function (scope) {
        checkConfigDiagnostics([ fatal ], { kind: 'parse-failure', message: /token/gu });
        scope.assert.throws(function () {
            checkConfigDiagnostics([ message ], { kind: 'parse-failure', message: /token/u });
        }, { message: /Expected a parser failure/u });
        scope.assert.throws(function () {
            checkConfigDiagnostics([ fatal ], { kind: 'parse-failure', message: /different/u });
        }, { message: /Parser failure does not match/u });
        scope.assert.throws(function () {
            checkConfigDiagnostics([ fatal ], { kind: 'clean' });
        }, { message: /Unexpected parser failure/u });
        return scope.assert.collect();
    }),
    test('accepts equivalent numeric and named rule severities', function (scope) {
        scope.assert(
            subjectAssertion(ruleCheck),
            'Configuration matches',
            observeRule(function () {
                checkResolvedConfig(actual, expectation);
                checkResolvedConfig({ ...actual, rules: { eqeqeq: [ 2, 'always' ] } }, {
                    ...expectation,
                    rules: { eqeqeq: [ 'error', 'always' ] }
                });
            }, scope.signal)
        );
        return scope.assert.collect();
    }),
    test('rejects missing, forbidden, and unexpected configured rules', function (scope) {
        scope.assert.throws(function () {
            checkResolvedConfig({ ...actual, rules: {} }, expectation);
        }, { message: /Rule eqeqeq is missing/u });
        scope.assert.throws(function () {
            checkResolvedConfig(actual, { ...expectation, rules: { eqeqeq: null } });
        }, { message: /Rule eqeqeq must be absent/u });
        scope.assert.throws(function () {
            checkResolvedConfig({ ...actual, rules: { ...actual.rules, extra: 1 } }, expectation);
        }, { message: /Configured rule names differ/u });
        scope.assert.throws(function () {
            checkResolvedConfig({ ...actual, rules: { eqeqeq: 1 } }, expectation);
        }, { message: /Rule eqeqeq differs/u });
        return scope.assert.collect();
    }),
    test('checks parser identity and selected language and settings fields', function (scope) {
        const parser = {};
        checkResolvedConfig({
            ...actual,
            languageOptions: { parser, ecmaVersion: 2025 },
            settings: { domain: 'application' }
        }, {
            ...expectation,
            languageOptions: { parser, ecmaVersion: 2025 },
            settings: { domain: 'application' }
        });
        scope.assert.throws(function () {
            checkResolvedConfig({ ...actual, languageOptions: { parser: {} } }, {
                ...expectation,
                languageOptions: { parser }
            });
        }, { message: /Parser identity differs/u });
        scope.assert.throws(function () {
            checkResolvedConfig(actual, { ...expectation, settings: { domain: 'application' } });
        }, { code: 'ERR_ASSERTION', message: /domain: 'application'/u });
        return scope.assert.collect();
    })
]);
