import { suite, test } from '@overkill-dev/test';

import {
    getCompositeAssertionReferenceRecord,
    unknownSourceLocation
} from '../engine/assertion-protocol.entry-point.ts';
import { types } from './type-test.entry-point.ts';

export const testNode = suite('native type assertion references', [
    test('fails ordinary execution instead of reporting a successful erased check', function (scope) {
        const reference = types.equal<string, number>();
        scope.assert.throws(function () {
            return getCompositeAssertionReferenceRecord(reference).run({
                message: null,
                parameters: [],
                source: 'assert',
                sourceLocations: [ unknownSourceLocation ]
            });
        }, { message: /requires the type-test family/u });
        return scope.assert.collect();
    }),
    test('keeps negation and key checks checker-only', function (scope) {
        scope.assert.throws(function () {
            return getCompositeAssertionReferenceRecord(types.notEqual<string, number>()).run({
                message: null,
                parameters: [],
                source: 'assert',
                sourceLocations: [ unknownSourceLocation ]
            });
        }, { message: /notEqual/u });
        scope.assert.throws(function () {
            return getCompositeAssertionReferenceRecord(types.hasKey<{ readonly value: number; }, 'value'>()).run({
                message: null,
                parameters: [],
                source: 'assert',
                sourceLocations: [ unknownSourceLocation ]
            });
        }, { message: /requires the type-test family/u });
        return scope.assert.collect();
    })
]);
