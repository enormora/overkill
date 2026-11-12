import { ESLintUtils } from '@typescript-eslint/utils';
import * as parser from '@typescript-eslint/parser';
import { suite, test } from '../packages/test/test.entry-point.ts';
import { createRoot, createTestPlan, execute } from '../packages/engine/engine.entry-point.ts';
import { defineRuleTests } from '../packages/eslint-rule-test/eslint-rule-test.entry-point.ts';

const rule = ESLintUtils.RuleCreator.withoutDocs({
    defaultOptions: [],
    meta: { type: 'problem', schema: [], messages: { interface: 'An interface was found.' } },
    create(context) {
        return {
            TSInterfaceDeclaration(node) {
                context.report({ node, messageId: 'interface' });
            }
        };
    }
});

export const testNode = suite('typed ESLint SDK interoperability', [
    test('accepts TypeScript rule definitions and invokes their typed visitors', async function (scope) {
        const definition = defineRuleTests({
            name: 'typed-rule',
            rule,
            configs: { ts: { languageOptions: { parser } } },
            valid: [ { code: 'const value = 1;', filename: 'rule-test.ts' } ],
            invalid: [ {
                code: 'interface Example {}',
                filename: 'rule-test.ts',
                errors: [ { messageId: 'interface' } ]
            } ]
        });
        const result = await execute(
            createTestPlan(
                createRoot({ title: 'sdk', annotations: {}, controls: {}, children: [ definition.examples() ] })
            )
        );
        scope.assert.equal(result.summary.passed, 2);
        scope.assert.equal(result.summary.failed, 0);
        return scope.assert.collect();
    })
]);
