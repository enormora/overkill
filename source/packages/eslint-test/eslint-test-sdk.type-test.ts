import { isEqualTo } from '../../test-support/type-relations.ts';
import { test } from '@overkill-dev/test';
import { sameType } from '@overkill-dev/type-test';
import type { TSESLint } from '@typescript-eslint/utils';
import type { Suite } from '../engine/engine.entry-point.ts';
import { defineRuleTests } from './eslint-test.entry-point.ts';

export const testNode = test(
    'accepts typed SDK rule modules without weakening their own context types',
    function (typeScope) {
        const rule: TSESLint.RuleModule<'found'> = {
            defaultOptions: [],
            meta: { type: 'problem', schema: [], messages: { found: 'Found.' } },
            create(context) {
                typeScope.assert(sameType.withActual<[]>(), context.options);
                return {};
            }
        };
        const rules = defineRuleTests({ name: 'typed', rule, configs: { ts: {} }, valid: [], invalid: [] });
        typeScope.assert(sameType.withActual<true>(), isEqualTo<Suite>()(rules.examples()));
        return typeScope.assert.collect();
    }
);
