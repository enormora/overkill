import type { Rule } from 'eslint';
import { inconclusivePropertyTrial, type TestScope } from '../packages/engine/engine.entry-point.ts';
import { gen } from '../packages/property/property.entry-point.ts';
import { suite, test } from '../packages/test/test.entry-point.ts';
import { defineRuleTests } from '../packages/eslint-rule-test/eslint-rule-test.entry-point.ts';
import { executePropertyNode, propertyExecutionDefaults } from '../test-support/property-execution.ts';
import type { RuleInput } from './rule-definition.ts';

const input = gen.constant(null).map(function source(): RuleInput {
    return { code: 'const first = 1;', options: [] };
});
const generation = {
    syntax: 'javascript',
    filename: 'rule-test.js',
    convergence: { kind: 'disabled' },
    input
} as const;
const definition = { name: 'replay controls', configs: {}, valid: [], invalid: [], generation };

export const testNode = suite('ESLint replay and property controls', [
    test('reports ignored generated filenames as inconclusive', async function (scope) {
        const rule: Rule.RuleModule = {
            create() {
                return {};
            }
        };
        const request = {
            ...propertyExecutionDefaults,
            policy: { ...propertyExecutionDefaults.policy, newTrials: 1, maxWork: 1000 }
        };
        const valid = await executePropertyNode(defineRuleTests({ ...definition, rule }).properties(), request);
        const ignored = await executePropertyNode(
            defineRuleTests({ ...definition, rule, generation: { ...generation, filename: 'node_modules/ignored.js' } })
                .properties(),
            request
        );
        scope.assert.equal(valid.summary.passed, 1);
        scope.assert.equal(ignored.summary.inconclusive, 1);
        scope.assert.equal(ignored.summary.failed, 0);
        return scope.assert.collect();
    }),
    test('replaying under an incompatible parser is inconclusive', async function (scope: TestScope) {
        const rule: Rule.RuleModule = {
            create() {
                throw new Error('rule crash');
            }
        };
        const failed = await executePropertyNode(
            defineRuleTests({ ...definition, rule, configs: { js: {} } }).properties(),
            propertyExecutionDefaults
        );
        scope.assert.equal(failed.summary.failed, 1);
        const witness = failed.perTest[0]?.property?.invocations[0]?.confirmedWitness;
        scope.require.defined(witness);
        const incompatible = defineRuleTests({
            ...definition,
            rule,
            configs: { js: { languageOptions: { ecmaVersion: 5, sourceType: 'script' } } }
        });
        const replayed = await executePropertyNode(incompatible.properties(), {
            ...propertyExecutionDefaults,
            replay: witness
        });
        scope.assert.equal(replayed.summary.inconclusive, 1);
        scope.assert.equal(replayed.summary.failed, 0);
        return scope.assert.collect();
    }),
    test('preserves property inconclusive control raised inside a rule', async function (scope) {
        const rule: Rule.RuleModule = {
            create() {
                return inconclusivePropertyTrial('Rule prerequisites unavailable.');
            }
        };
        const rules = defineRuleTests({ ...definition, rule });
        const result = await executePropertyNode(rules.properties(), propertyExecutionDefaults);
        scope.assert.equal(result.summary.inconclusive, 1);
        scope.assert.equal(result.summary.failed, 0);
        scope.assert.includes(JSON.stringify(result), 'Rule prerequisites unavailable.');
        return scope.assert.collect();
    }),
    test('accepts a fixer that stabilizes on its last permitted pass', async function (scope) {
        const rule: Rule.RuleModule = {
            meta: { schema: [], fixable: 'code', messages: { rename: 'Rename first.' } },
            create(context) {
                return {
                    Identifier(node) {
                        if (node.name === 'first') {
                            context.report({
                                node,
                                messageId: 'rename',
                                fix(fixer) {
                                    return fixer.replaceText(node, 'second');
                                }
                            });
                        }
                    }
                };
            }
        };
        const rules = defineRuleTests({
            ...definition,
            rule,
            generation: { ...generation, convergence: { kind: 'bounded', maxPasses: 1 } }
        });
        const result = await executePropertyNode(rules.properties(), propertyExecutionDefaults);
        scope.assert.equal(result.summary.passed, 1);
        scope.assert.equal(result.summary.failed, 0);
        return scope.assert.collect();
    })
]);
