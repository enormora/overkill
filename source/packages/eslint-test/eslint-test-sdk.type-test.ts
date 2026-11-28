import type { TSESLint } from '@typescript-eslint/utils';
import { test } from '../test/test.entry-point.ts';
import { sameType } from '../type-test/type-test.entry-point.ts';
import type { Suite } from '../engine/engine.entry-point.ts';
import { isEqualTo } from '../../test-support/type-relations.ts';
import { defineRuleTests } from './eslint-test.entry-point.ts';

export const testNode = test(
    'accepts typed SDK rule modules without weakening their own context types',
    function (scope) {
        const rule: TSESLint.RuleModule<'found'> = {
            defaultOptions: [],
            meta: { type: 'problem', schema: [], messages: { found: 'Found.' } },
            create(context) {
                scope.assert(sameType.withActual<true>(), isEqualTo<[]>()(context.options));
                return {};
            }
        };
        const rules = defineRuleTests({ name: 'typed', rule, configs: { ts: {} }, valid: [], invalid: [] });
        scope.assert(sameType.withActual<true>(), isEqualTo<Suite>()(rules.examples()));
        return scope.assert.collect();
    }
);
