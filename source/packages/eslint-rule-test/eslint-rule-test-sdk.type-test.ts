import { expect, test } from 'tstyche';
import type { TSESLint } from '@typescript-eslint/utils';
import type { Suite } from '../engine/engine.entry-point.ts';
import { defineRuleTests } from './eslint-rule-test.entry-point.ts';

test('accepts typed SDK rule modules without weakening their own context types', function () {
    const rule: TSESLint.RuleModule<'found'> = {
        defaultOptions: [],
        meta: { type: 'problem', schema: [], messages: { found: 'Found.' } },
        create(context) {
            expect(context.options).type.toBe<[]>();
            return {};
        }
    };
    const rules = defineRuleTests({ name: 'typed', rule, configs: { ts: {} }, valid: [], invalid: [] });
    expect(rules.examples()).type.toBe<Suite>();
});
