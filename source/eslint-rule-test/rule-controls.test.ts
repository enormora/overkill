import type { Rule } from 'eslint';
import { createRoot, createTestPlan, execute, type TestScope } from '../packages/engine/engine.entry-point.ts';
import { gen } from '../packages/property/property.entry-point.ts';
import { suite, test } from '../packages/test/test.entry-point.ts';
import { defineRuleTests } from '../packages/eslint-rule-test/eslint-rule-test.entry-point.ts';
import { executePropertyNode, propertyExecutionDefaults } from '../test-support/property-execution.ts';
import { observeRule } from './rule-observation.ts';
import type { RuleInput } from './rule-definition.ts';

const input = gen.constant(null).map(function source(): RuleInput {
    return { code: 'first', options: [] };
});
const generation = {
    syntax: 'javascript',
    filename: 'rule-test.js',
    convergence: { kind: 'bounded', maxPasses: 2 },
    input
} as const;

export const testNode = suite('ESLint control and fixer contracts', [
    test('does not resume rule evaluation after a required assertion halts it', async function (scope) {
        let continued = false;
        const result = await execute(createTestPlan(createRoot({
            title: 'required control',
            annotations: {},
            controls: {},
            children: [ test('required assertion', function (inner: TestScope) {
                observeRule(function requireValue() {
                    inner.require.defined(undefined);
                }, inner.signal);
                continued = true;
                return inner.assert.collect();
            }) ]
        })));
        scope.assert.equal(result.summary.failed, 1);
        scope.assert.false(continued);
        return scope.assert.collect();
    }),
    test('fails oscillating fixes only when convergence is requested', async function (scope) {
        const rule: Rule.RuleModule = {
            meta: { schema: [], fixable: 'code', messages: { change: 'change' } },
            create(context) {
                return {
                    Identifier(node) {
                        context.report({
                            node,
                            messageId: 'change',
                            fix(fixer) {
                                return fixer.replaceText(
                                    node,
                                    node.name === 'first'
                                        ? 'second'
                                        : 'first'
                                );
                            }
                        });
                    }
                };
            }
        };
        const bounded = defineRuleTests({ name: 'oscillation', rule, configs: {}, valid: [], invalid: [], generation });
        const failed = await executePropertyNode(bounded.properties(), propertyExecutionDefaults);
        scope.assert.equal(failed.summary.failed, 1);
        scope.assert.includes(JSON.stringify(failed), 'Autofixes converge');
        const unbounded = defineRuleTests({
            name: 'syntax-only',
            rule,
            configs: {},
            valid: [],
            invalid: [],
            generation: { ...generation, convergence: { kind: 'disabled' } }
        });
        const passed = await executePropertyNode(unbounded.properties(), propertyExecutionDefaults);
        scope.assert.equal(passed.summary.passed, 1);
        return scope.assert.collect();
    }),
    test('checks each suggestion in isolation', async function (scope) {
        const rule: Rule.RuleModule = {
            meta: { schema: [], hasSuggestions: true, messages: { change: 'change' } },
            create(context) {
                return {
                    Identifier(node) {
                        context.report({
                            node,
                            messageId: 'change',
                            suggest: [
                                {
                                    messageId: 'change',
                                    fix(fixer) {
                                        return fixer.replaceText(node, '(');
                                    }
                                }
                            ]
                        });
                    }
                };
            }
        };
        const rules = defineRuleTests({ name: 'suggestions', rule, configs: {}, valid: [], invalid: [], generation });
        const result = await executePropertyNode(rules.properties(), propertyExecutionDefaults);
        scope.assert.equal(result.summary.failed, 1);
        scope.assert.includes(JSON.stringify(result), 'Fixes preserve syntax');
        return scope.assert.collect();
    }),
    test('propagates permission failures without turning them into assertions', function (scope) {
        const error = Object.assign(new Error('denied'), { code: 'ERR_ACCESS_DENIED' });
        const controller = new AbortController();
        scope.assert.throws(function permission() {
            observeRule(function denied() {
                throw error;
            }, controller.signal);
        }, { message: 'denied' });
        return scope.assert.collect();
    }),
    test('does not admit a cancelled rule invocation', function (scope) {
        const controller = new AbortController();
        controller.abort(new Error('cancelled'));
        let admitted = false;
        scope.assert.throws(function cancelled() {
            observeRule(function invoke() {
                admitted = true;
            }, controller.signal);
        }, { message: 'cancelled' });
        scope.assert.false(admitted);
        return scope.assert.collect();
    })
]);
