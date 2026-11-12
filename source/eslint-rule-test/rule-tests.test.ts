import type { Rule } from 'eslint';
import {
    createRoot,
    createTestPlan,
    execute,
    type RunResult,
    type Suite
} from '../packages/engine/engine.entry-point.ts';
import { suite, test } from '../packages/test/test.entry-point.ts';
import { defineRuleTests } from '../packages/eslint-rule-test/eslint-rule-test.entry-point.ts';

async function run(node: Suite): Promise<RunResult> {
    return await execute(
        createTestPlan(
            createRoot({
                title: 'consumer',
                annotations: {},
                controls: {},
                children: [ node ]
            })
        )
    );
}

const noFoo = {
    meta: { schema: [], messages: { forbidden: 'foo is forbidden' } },
    create(context: Readonly<Rule.RuleContext>): Rule.RuleListener {
        return {
            Identifier(node) {
                if (node.name === 'foo') {
                    context.report({ node, messageId: 'forbidden' });
                }
            }
        };
    }
};

export const testNode = suite('ESLint rule testing', [
    test('expands shared configurations with per-case restrictions', async function (scope) {
        const rules = defineRuleTests({
            name: 'no-foo',
            rule: noFoo,
            configs: { modern: {}, old: {} },
            valid: [ 'bar()', { code: 'bar()', configs: [ 'modern' ] }, { code: 'bar()', configs: 'base' } ],
            invalid: [ { code: 'foo()', errors: [ { messageId: 'forbidden' } ] } ]
        });
        const result = await run(rules.examples());
        scope.assert.equal(result.summary.passed, 6);
        scope.assert.equal(result.summary.failed, 0);
        return scope.assert.collect();
    }),
    test('reports wrong diagnostics as failed assertions', async function (scope) {
        const rules = defineRuleTests({ name: 'no-foo', rule: noFoo, configs: {}, valid: [ 'foo()' ], invalid: [] });
        const result = await run(rules.examples());
        scope.assert.equal(result.summary.failed, 1);
        return scope.assert.collect();
    }),
    test('rejects unknown configuration names at construction', function (scope) {
        scope.assert.throws(function unknownConfig() {
            Reflect.apply(defineRuleTests, undefined, [ {
                name: 'no-foo',
                rule: noFoo,
                configs: { modern: {} },
                valid: [ { code: 'bar()', configs: [ 'missing' ] } ],
                invalid: []
            } ]);
        }, { message: 'Configuration selection must contain unique known names.' });
        return scope.assert.collect();
    }),
    test('constructs fresh trees without creating unused property nodes', function (scope) {
        const rules = defineRuleTests({
            name: 'no-foo',
            rule: noFoo,
            configs: { modern: {} },
            valid: [ 'bar()' ],
            invalid: []
        });
        scope.assert.notEqual(rules.examples(), rules.examples());
        scope.assert.equal(rules.properties().children.length, 1);
        return scope.assert.collect();
    }),
    test('checks message data, locations, fixes and isolated suggestions', async function (scope) {
        const rule: Rule.RuleModule = {
            meta: {
                schema: [],
                fixable: 'code',
                hasSuggestions: true,
                messages: { renamed: 'Rename {{ name }}.', suggestion: 'Use {{ name }}.' }
            },
            create(context) {
                return {
                    Identifier(node) {
                        context.report({
                            node,
                            messageId: 'renamed',
                            data: { name: node.name },
                            fix(fixer) {
                                return fixer.replaceText(node, 'bar');
                            },
                            suggest: [ {
                                messageId: 'suggestion',
                                data: { name: 'baz' },
                                fix(fixer) {
                                    return fixer.replaceText(node, 'baz');
                                }
                            } ]
                        });
                    }
                };
            }
        };
        const rules = defineRuleTests({
            name: 'fixes',
            rule,
            configs: {},
            valid: [],
            invalid: [ {
                code: 'foo',
                output: 'bar',
                errors: [ {
                    messageId: 'renamed',
                    data: { name: 'foo' },
                    line: 1,
                    column: 1,
                    endLine: 1,
                    endColumn: 4,
                    suggestions: [ { messageId: 'suggestion', data: { name: 'baz' }, output: 'baz' } ]
                } ]
            } ]
        });
        const result = await run(rules.examples());
        scope.assert.equal(result.summary.passed, 1);
        return scope.assert.collect();
    }),
    test('supports explicit parsing-error expectations without requiring valid source', async function (scope) {
        const rules = defineRuleTests({
            name: 'parse errors',
            rule: noFoo,
            configs: {},
            valid: [],
            invalid: [ { code: 'const =', errors: [ { message: /Unexpected token/ } ] } ]
        });
        const result = await run(rules.examples());
        scope.assert.equal(result.summary.passed, 1);
        return scope.assert.collect();
    }),
    test('rejects fix expectations on valid cases before execution', function (scope) {
        scope.assert.throws(function invalidShape() {
            Reflect.apply(defineRuleTests, undefined, [ {
                name: 'shape',
                rule: noFoo,
                configs: {},
                valid: [ { code: 'bar()', output: 'foo()' } ],
                invalid: []
            } ]);
        }, { message: 'Valid cases must not contain error or fix expectations.' });
        return scope.assert.collect();
    })
]);
