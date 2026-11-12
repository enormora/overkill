import { Linter, type Rule } from 'eslint';
import * as tsParser from '@typescript-eslint/parser';
import { gen, sampleGenerator } from '../packages/property/property.entry-point.ts';
import { suite, test } from '../packages/test/test.entry-point.ts';
import { defineRuleTests } from '../packages/eslint-rule-test/eslint-rule-test.entry-point.ts';
import { executePropertyNode, propertyExecutionDefaults } from '../test-support/property-execution.ts';
import { createRoot, createTestPlan, execute } from '../packages/engine/engine.entry-point.ts';
import type { ESLintTestConfig, RuleInput } from './rule-definition.ts';
import { ruleInputs } from './rule-inputs.ts';

const noOp: Rule.RuleModule = {
    meta: { schema: [] },
    create() {
        return {};
    }
};
const typedGeneration = { syntax: 'typescript', filename: 'rule-test.ts', convergence: { kind: 'disabled' } } as const;

export const testNode = suite('ESLint parser and configuration composition', [
    test('generates parseable programs for legacy and modern JavaScript versions', function (scope) {
        const linter = new Linter();
        for (const version of [ 5, 2015 ]) {
            const config: ESLintTestConfig = { languageOptions: { ecmaVersion: version, sourceType: 'script' } };
            const samples = sampleGenerator(
                ruleInputs(noOp, {
                    name: 'versions',
                    config,
                    generation: { syntax: 'javascript', filename: 'rule-test.js', convergence: { kind: 'disabled' } }
                }, []),
                { seed: 42n, count: 40, size: 6, depth: 2 }
            );
            scope.assert.equal(samples.length, 40);
            scope.assert.true(samples.every(function parses(value) {
                return linter
                    .verify(value.code, [ { ...config, files: [ '**/*.js' ] } ], {
                        filename: 'rule-test.js',
                        allowInlineConfig: false
                    })
                    .length === 0;
            }));
        }
        return scope.assert.collect();
    }),
    test('uses a shared TypeScript parser for examples and automatic properties', async function (scope) {
        const rules = defineRuleTests({
            name: 'typescript',
            rule: noOp,
            configs: { ts: { languageOptions: { parser: tsParser }, generation: typedGeneration } },
            valid: [ { code: 'const value: number = 1;', filename: 'rule-test.ts' } ],
            invalid: []
        });
        const examples = await execute(
            createTestPlan(
                createRoot({ title: 'consumer', annotations: {}, controls: {}, children: [ rules.examples() ] })
            )
        );
        scope.assert.equal(examples.summary.passed, 1);
        const properties = await executePropertyNode(rules.properties(), propertyExecutionDefaults);
        scope.assert.equal(properties.summary.passed, 1);
        return scope.assert.collect();
    }),
    test('includes per-case overrides when replaying original examples', async function (scope) {
        const rule: Rule.RuleModule = {
            meta: { schema: [] },
            create(context) {
                if (context.sourceCode.text === 'original' && context.settings.flag !== true) {
                    throw new Error('missing case setting');
                }
                return {};
            }
        };
        const input = gen.constant(null).map(function generated(): RuleInput {
            return { code: 'generated', options: [] };
        });
        const rules = defineRuleTests({
            name: 'settings',
            rule,
            configs: {},
            settings: { flag: false },
            generation: { ...typedGeneration, syntax: 'javascript', filename: 'rule-test.js', input },
            valid: [ { code: 'original', settings: { flag: true } } ],
            invalid: []
        });
        const result = await executePropertyNode(rules.properties(), propertyExecutionDefaults);
        scope.assert.equal(result.summary.passed, 1);
        return scope.assert.collect();
    }),
    test('narrows defaults while retaining explicit exceptions', function (scope) {
        const rules = defineRuleTests({
            name: 'exceptions',
            rule: noOp,
            configs: { first: {}, second: {} },
            defaultConfigs: [ 'first' ],
            valid: [ 'value', { code: 'value', configs: [ 'second' ] }, { code: 'value', configs: 'base' } ],
            invalid: []
        });
        scope.assert.equal(rules.examples().children.length, 3);
        scope.assert.equal(rules.properties().children.length, 3);
        return scope.assert.collect();
    }),
    test('generates multiple syntax constructs and TypeScript declarations', function (scope) {
        const generator = ruleInputs(noOp, { name: 'ts', config: {}, generation: typedGeneration }, []);
        const samples = sampleGenerator(generator, { seed: 42n, count: 30, size: 8, depth: 3 });
        scope.assert.true(samples.some(function typed(input) {
            return /interface |type |enum |: unknown/.test(input.code);
        }));
        scope.assert.true(samples.some(function functionOrLoop(input) {
            return /function |for \(/.test(input.code);
        }));
        return scope.assert.collect();
    })
]);
