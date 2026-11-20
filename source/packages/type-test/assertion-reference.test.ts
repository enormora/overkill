import { type TestNode, suite, test } from '@overkill-dev/test';

import {
    getCompositeAssertionReferenceRecord,
    unknownSourceLocation
} from '../engine/assertion-protocol.entry-point.ts';
import { sameType } from './type-test.entry-point.ts';

export const testNode: TestNode = suite('native type assertion references', [
    test('fails ordinary execution instead of reporting a successful erased check', function (scope) {
        const reference = sameType<string, number>();
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
    test('keeps negation and expression forms checker-only', function (scope) {
        scope.assert.throws(function () {
            return getCompositeAssertionReferenceRecord(sameType.not.withActual<string>()).run({
                message: null,
                parameters: [ 42 ],
                source: 'assert',
                sourceLocations: [ unknownSourceLocation ]
            });
        }, { message: /not sameType/u });
        scope.assert.throws(function () {
            return getCompositeAssertionReferenceRecord(sameType.expressions).run({
                message: null,
                parameters: [ 1, 1 ],
                source: 'assert',
                sourceLocations: [ unknownSourceLocation ]
            });
        }, { message: /requires the type-test family/u });
        return scope.assert.collect();
    })
]);
