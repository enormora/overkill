import type { Rule } from 'eslint';
import type { TestScope } from '../packages/engine/engine.entry-point.ts';
import { gen, sampleGenerator } from '../packages/property/property.entry-point.ts';
import { suite, test } from '../packages/test/test.entry-point.ts';
import { defineRuleTests } from '../packages/eslint-rule-test/eslint-rule-test.entry-point.ts';
import { executePropertyNode, propertyExecutionDefaults } from '../test-support/property-execution.ts';
import type { RuleInput } from './rule-definition.ts';
import { optionInputs } from './option-schemas.ts';

const noOp: Rule.RuleModule = {
    meta: { schema: [] },
    create() {
        return {};
    }
};
const fixedInput = gen.constant(null).map(function input(): RuleInput {
    return { code: 'var value = 1;', options: [] };
});
const generation = {
    syntax: 'javascript',
    filename: 'rule-test.js',
    convergence: { kind: 'disabled' },
    input: fixedInput
} as const;

export const testNode = suite('ESLint generated properties', [
    test('fuzzes options and retains a replayable failure', async function (scope: TestScope) {
        const rule: Rule.RuleModule = {
            meta: { schema: [ { enum: [ 'safe', 'crash' ] } ] },
            create(context) {
                if (context.options[0] === 'crash') {
                    throw new Error('option crash');
                }
                return {};
            }
        };
        const rules = defineRuleTests({ name: 'options', rule, configs: { js: {} }, valid: [], invalid: [] });
        const result = await executePropertyNode(rules.properties(), {
            ...propertyExecutionDefaults,
            policy: { ...propertyExecutionDefaults.policy, newTrials: 40 }
        });
        scope.assert.equal(result.summary.failed, 1);
        const witness = result.perTest[0]?.property?.invocations[0]?.confirmedWitness;
        scope.require.defined(witness);
        const replay = await executePropertyNode(rules.properties(), { ...propertyExecutionDefaults, replay: witness });
        scope.assert.equal(replay.summary.failed, 1);
        return scope.assert.collect();
    }),
    test('keeps exact expectations on original property examples', async function (scope) {
        const rules = defineRuleTests({
            name: 'expectations',
            rule: noOp,
            configs: {},
            valid: [],
            invalid: [ { code: 'var value = 1;', errors: 1 } ],
            generation
        });
        const result = await executePropertyNode(rules.properties(), propertyExecutionDefaults);
        scope.assert.equal(result.summary.failed, 1);
        return scope.assert.collect();
    }),
    test('does not transfer invalid labels to generated inputs', async function (scope) {
        const rule: Rule.RuleModule = {
            meta: { schema: [], messages: { forbidden: 'forbidden' } },
            create(context) {
                return {
                    Identifier(node) {
                        if (node.name === 'foo') {
                            context.report({ node, messageId: 'forbidden' });
                        }
                    }
                };
            }
        };
        const rules = defineRuleTests({
            name: 'labels',
            rule,
            configs: {},
            generation,
            valid: [],
            invalid: [ { code: 'foo()', errors: [ { messageId: 'forbidden' } ] } ]
        });
        const result = await executePropertyNode(rules.properties(), propertyExecutionDefaults);
        scope.assert.equal(result.summary.passed, 1);
        return scope.assert.collect();
    }),
    test('fails fixes that introduce syntax errors', async function (scope) {
        const rule: Rule.RuleModule = {
            meta: { schema: [], fixable: 'code', messages: { broken: 'broken' } },
            create(context) {
                return {
                    Program(node) {
                        context.report({
                            node,
                            messageId: 'broken',
                            fix(fixer) {
                                return fixer.replaceText(node, '(');
                            }
                        });
                    }
                };
            }
        };
        const rules = defineRuleTests({ name: 'fix-syntax', rule, configs: {}, valid: [], invalid: [], generation });
        const result = await executePropertyNode(rules.properties(), propertyExecutionDefaults);
        scope.assert.equal(result.summary.failed, 1);
        return scope.assert.collect();
    }),
    test('reports unsupported schemas before execution without blocking examples', async function (scope) {
        const rule: Rule.RuleModule = {
            meta: { schema: [ { type: 'object', patternProperties: { '^x': { type: 'string' } } } ] },
            create() {
                return {};
            }
        };
        const rules = defineRuleTests({ name: 'unsupported', rule, configs: {}, valid: [ 'bar()' ], invalid: [] });
        scope.assert.throws(rules.properties, { message: /Unsupported option schema keyword patternProperties/ });
        const overridden = defineRuleTests({ name: 'override', rule, configs: {}, valid: [], invalid: [], generation });
        const result = await executePropertyNode(overridden.properties(), propertyExecutionDefaults);
        scope.assert.equal(result.summary.passed, 1);
        scope.assert.equal(rules.examples().children.length, 1);
        return scope.assert.collect();
    }),
    test('generates object option combinations and local references', function (scope) {
        const rule: Rule.RuleModule = {
            meta: {
                schema: {
                    type: 'array',
                    minItems: 1,
                    maxItems: 1,
                    definitions: { mode: { enum: [ 'first', 'second' ] } },
                    items: {
                        type: 'object',
                        required: [ 'mode' ],
                        properties: { mode: { $ref: '#/definitions/mode' }, flag: { type: 'boolean' } },
                        additionalProperties: false
                    }
                }
            },
            create() {
                return {};
            }
        };
        const values = sampleGenerator(optionInputs(rule), { seed: 42n, count: 30, size: 8, depth: 3 });
        const unique = new Set(values.map(function serialized(value) {
            return JSON.stringify(value);
        }));
        scope.assert.greaterThan(unique.size, 2);
        scope.assert.true(values.every(function oneOption(options) {
            return options.length === 1;
        }));
        return scope.assert.collect();
    })
]);
