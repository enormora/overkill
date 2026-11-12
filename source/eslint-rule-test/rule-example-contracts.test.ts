import type { Linter, Rule, RuleTester } from 'eslint';
import { suite, test } from '../packages/test/test.entry-point.ts';
import {
    createRoot,
    createTestPlan,
    execute,
    type RunResult,
    type Suite
} from '../packages/engine/engine.entry-point.ts';
import { defineRuleTests } from '../packages/eslint-rule-test/eslint-rule-test.entry-point.ts';

const rule: Rule.RuleModule = {
    meta: { schema: [], hasSuggestions: true, messages: { found: 'Found {{ name }}.', replace: 'Use {{ name }}.' } },
    create(context) {
        return {
            Identifier(node) {
                context.report({
                    node,
                    messageId: 'found',
                    data: { name: node.name },
                    suggest: [ {
                        messageId: 'replace',
                        data: { name: 'bar' },
                        fix(fixer) {
                            return fixer.replaceText(node, 'bar');
                        }
                    } ]
                });
            }
        };
    }
};

async function run(node: Suite): Promise<RunResult> {
    return await execute(
        createTestPlan(createRoot({ title: 'contracts', annotations: {}, controls: {}, children: [ node ] }))
    );
}

const passing: readonly RuleTester.InvalidTestCase['errors'][] = [
    1,
    [ 'Found foo.' ],
    [ /Found foo/gu ],
    [ { message: /Found foo/u, suggestions: 1 } ],
    [ { message: 'Found foo.', suggestions: [ { desc: 'Use bar.', output: 'bar' } ] } ],
    [ { messageId: 'found', data: { name: 'foo' }, suggestions: [ { messageId: 'replace', output: 'bar' } ] } ]
];
const failing: readonly RuleTester.InvalidTestCase['errors'][] = [
    [ { message: 'wrong', suggestions: 1 } ],
    [ { messageId: 'found', line: 2, suggestions: 1 } ],
    [ { messageId: 'found', data: {}, suggestions: 1 } ],
    [ { message: 'Found foo.', messageId: 'found', suggestions: 1 } ],
    [ { message: 'Found foo.', data: { name: 'foo' }, suggestions: 1 } ],
    [ { messageId: 'found', suggestions: [ { desc: 'Use bar.', messageId: 'replace', output: 'bar' } ] } ],
    [ { messageId: 'found', suggestions: [ { desc: 'wrong', output: 'bar' } ] } ],
    [ { messageId: 'found', suggestions: [ { desc: 'Use bar.', output: 'wrong' } ] } ]
];
const definition = { name: 'contracts', rule, configs: {}, valid: [], invalid: [] };

export const testNode = suite('ESLint example contracts', [
    test('applies per-case configuration selection to invalid examples', async function (scope) {
        const rules = defineRuleTests({
            ...definition,
            configs: { first: {}, second: {} },
            invalid: [ { code: 'foo', errors: 1, configs: 'base' } ]
        });
        const result = await run(rules.examples());
        scope.assert.equal(result.summary.passed, 1);
        return scope.assert.collect();
    }),
    test(
        'matches counts, literal messages, regular expressions and suggestion descriptions repeatedly',
        async function (scope) {
            const rules = defineRuleTests({
                ...definition,
                invalid: passing.map(function example(errors) {
                    return { code: 'foo', errors };
                })
            });
            for (const node of [ rules.examples(), rules.examples() ]) {
                const result = await run(node);
                scope.assert.equal(result.summary.passed, passing.length);
                scope.assert.equal(result.summary.failed, 0);
                scope.assert.equal(result.runnerErrors.length, 0);
            }
            return scope.assert.collect();
        }
    ),
    test(
        'rejects incorrect diagnostics, incomplete data and contradictory suggestion expectations',
        async function (scope) {
            const rules = defineRuleTests({
                ...definition,
                invalid: failing.map(function example(errors) {
                    return { code: 'foo', errors };
                })
            });
            const result = await run(rules.examples());
            scope.assert.equal(result.summary.failed, failing.length);
            scope.assert.equal(result.summary.passed, 0);
            scope.assert.equal(result.runnerErrors.length, 0);
            return scope.assert.collect();
        }
    ),
    test(
        'rejects reserved configurations, duplicate selections, hooks and unchanged fix expectations',
        function (scope) {
            const cases = [
                {
                    value: { ...definition, configs: { base: {} } },
                    message: 'The configuration name base is reserved.'
                },
                {
                    value: { ...definition, configs: { selected: {} }, defaultConfigs: [ 'selected', 'selected' ] },
                    message: 'Configuration selection must contain unique known names.'
                },
                {
                    value: {
                        ...definition,
                        valid: [ {
                            code: 'foo',
                            before() {
                                throw new Error('Hooks must not execute.');
                            }
                        } ]
                    },
                    message: 'Unsupported rule case field before.'
                },
                {
                    value: { ...definition, valid: [ { code: 'foo', errors: 1 } ] },
                    message: 'Valid cases must not contain error or fix expectations.'
                },
                {
                    value: { ...definition, invalid: [ { code: 'foo', errors: 1, output: 'foo' } ] },
                    message: 'Use null or omit output when no fix is expected.'
                }
            ];
            for (const { value, message } of cases) {
                scope.assert.throws(function () {
                    Reflect.apply(defineRuleTests, undefined, [ value ]);
                }, { message });
            }
            return scope.assert.collect();
        }
    ),
    test('rejects a custom input source that is not an Overkill generator', function (scope) {
        scope.assert.throws(
            function () {
                Reflect.apply(defineRuleTests, undefined, [ {
                    ...definition,
                    generation: {
                        syntax: 'javascript',
                        filename: 'rule-test.js',
                        convergence: { kind: 'disabled' },
                        input: {}
                    }
                } ]);
            },
            { message: 'generation.input must be an Overkill generator.' }
        );
        return scope.assert.collect();
    }),
    test(
        'accepts metadata-free rules and ignores absent listeners while invoking real listeners',
        async function (scope) {
            const bare = {
                create(context: Readonly<Rule.RuleContext>) {
                    return {
                        Program: undefined,
                        'Program:exit'() {
                            context.report({ node: context.sourceCode.ast, message: 'literal' });
                        }
                    };
                }
            };
            const rules = defineRuleTests({
                ...definition,
                rule: bare,
                invalid: [ { code: 'value', errors: [ 'literal' ] } ]
            });
            const result = await run(rules.examples());
            scope.assert.equal(result.summary.passed, 1);
            return scope.assert.collect();
        }
    ),
    test('reports malformed listener values as rule failures', async function (scope) {
        const rules = defineRuleTests({
            ...definition,
            rule: {
                create() {
                    return { Program: 42 };
                }
            },
            valid: [ 'value' ]
        });
        const result = await run(rules.examples());
        scope.assert.equal(result.summary.failed, 1);
        scope.assert.includes(JSON.stringify(result), 'A rule listener must be a function.');
        return scope.assert.collect();
    }),
    test('preserves shared globals when a named processor rewrites source', async function (scope) {
        const processor: Linter.Processor = {
            preprocess() {
                return [ 'var value;' ];
            },
            postprocess(messages) {
                return messages.flat();
            }
        };
        const globals: Rule.RuleModule = {
            create(context) {
                const names = context.languageOptions.globals ?? {};
                if (!Object.hasOwn(names, 'base') || !Object.hasOwn(names, 'named')) {
                    throw new Error('Missing globals.');
                }
                return {};
            }
        };
        const rules = defineRuleTests({
            ...definition,
            rule: globals,
            languageOptions: { globals: { base: 'readonly' } },
            configs: { processed: { processor, languageOptions: { globals: { named: 'writable' } } } },
            valid: [ { code: 'not valid ???', filename: 'virtual.js' } ]
        });
        const result = await run(rules.examples());
        scope.assert.equal(result.summary.passed, 1);
        return scope.assert.collect();
    }),
    test('reports unknown language selections as failed examples', async function (scope) {
        const rules = defineRuleTests({
            ...definition,
            rule: {
                create() {
                    return {};
                }
            },
            configs: { unknown: { language: 'missing/language' } },
            valid: [ 'value' ]
        });
        const result = await run(rules.examples());
        scope.assert.equal(result.summary.failed, 1);
        scope.assert.equal(result.runnerErrors.length, 0);
        return scope.assert.collect();
    })
]);
