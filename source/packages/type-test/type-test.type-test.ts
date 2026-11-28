import { test } from '../../../tools/type-tests/authoring.entry-point.ts';
import { acceptsCall, rejectsCall } from '../../../tools/type-tests/relations.entry-point.ts';
import type { TestScope } from '../engine/engine.entry-point.ts';
import { types } from './type-test.entry-point.ts';

declare const scope: TestScope;

export const testNode = test(
    'comparison references are assert-only and take no runtime operands',
    function (typeScope) {
        typeScope.assert(acceptsCall, () => scope.assert(types.equal<string, number>()));
        typeScope.assert(rejectsCall('argument-count'), () => scope.require(types.equal<string, string>()));
        typeScope.assert(rejectsCall('argument-count'), () =>
            scope.assert(types.assignableTo<string, unknown>(), 'value'));
        typeScope
            .assert(acceptsCall, () => scope.assert(types.hasKey<{ readonly value: string; }, 'value'>()));
        typeScope.assert(
            rejectsCall('argument-count'),
            () => types.hasKey<{ readonly value: string; }, 'value' | 'other'>()
        );
        return typeScope.assert.collect();
    }
);
