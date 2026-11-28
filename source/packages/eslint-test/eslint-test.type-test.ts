import type { Rule } from 'eslint';
import { suite, test } from '@overkill-dev/test';
import { rejectsCall, sameType } from '@overkill-dev/type-test';
import type { Suite } from '../engine/engine.entry-point.ts';
import { isEqualTo, isAssignableTo } from '../../test-support/type-relations.ts';
import { defineRuleTests, type ConfigSelection } from './eslint-test.entry-point.ts';

const rule: Rule.RuleModule = {
    create() {
        return {};
    }
};

export const testNode = suite('Typed ESLint rule verification', [
    test('returns ordinary suite builders for shared configurations', function (scope) {
        const definition = defineRuleTests({
            name: 'rule',
            rule,
            configs: { js: {}, ts: {} },
            valid: [ 'value', { code: 'value', configs: [ 'ts' ] } ],
            invalid: []
        });
        scope.assert(sameType.withActual<true>(), isEqualTo<Suite>()(definition.examples()));
        scope.assert(sameType.withActual<true>(), isEqualTo<Suite>()(definition.properties()));
        return scope.assert.collect();
    }),
    test('restricts configuration selections to declared names', function (scope) {
        scope.assert(
            sameType.withActual<true>(),
            isAssignableTo<ConfigSelection<'js' | 'ts'>>()([ 'js' ] as const)
        );
        scope.assert(
            sameType.withActual<false>(),
            isAssignableTo<ConfigSelection<'js' | 'ts'>>()([ 'missing' ] as const)
        );
        scope.assert(sameType.withActual<false>(), isAssignableTo<ConfigSelection<'js' | 'ts'>>()([] as const));
        scope.assert(rejectsCall('argument-type'), function () {
            return defineRuleTests<'js'>({
                name: 'rule',
                rule,
                configs: { js: {} },
                valid: [ { code: 'value', configs: [ 'missing' ] } ],
                invalid: []
            });
        });
        return scope.assert.collect();
    })
]);
