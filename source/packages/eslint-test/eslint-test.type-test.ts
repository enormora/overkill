import { isEqualTo } from '../../test-support/type-relations.ts';
import { suite, test } from '@overkill-dev/test';
import { assignableTo, rejectsCall, sameType } from '@overkill-dev/type-test';
import type { Rule } from 'eslint';
import type { Suite } from '../engine/engine.entry-point.ts';
import { defineRuleTests, type ConfigSelection } from './eslint-test.entry-point.ts';

const rule: Rule.RuleModule = {
    create() {
        return {};
    }
};

export const testNode = suite('eslint test', [
    test('returns ordinary suite builders for shared configurations', function (typeScope) {
        const definition = defineRuleTests({
            name: 'rule',
            rule,
            configs: { js: {}, ts: {} },
            valid: [ 'value', { code: 'value', configs: [ 'ts' ] } ],
            invalid: []
        });
        typeScope.assert(sameType.withActual<true>(), isEqualTo<Suite>()(definition.examples()));
        typeScope.assert(sameType.withActual<true>(), isEqualTo<Suite>()(definition.properties()));
        return typeScope.assert.collect();
    }),
    test('restricts configuration selections to declared names', function (typeScope) {
        typeScope.assert(assignableTo.withActual<ConfigSelection<'js' | 'ts'>>(), [ 'js' ] as const);
        typeScope.assert(assignableTo.not.withActual<ConfigSelection<'js' | 'ts'>>(), [ 'missing' ] as const);
        typeScope.assert(assignableTo.not.withActual<ConfigSelection<'js' | 'ts'>>(), [] as const);
        typeScope.assert(rejectsCall('argument-type'), () =>
            defineRuleTests<'js'>({
                name: 'rule',
                rule,
                configs: { js: {} },
                valid: [ { code: 'value', configs: [ 'missing' ] } ],
                invalid: []
            }));
        return typeScope.assert.collect();
    })
]);
