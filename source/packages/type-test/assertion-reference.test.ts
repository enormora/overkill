import { runIfMain } from '#test-runner';
import { suite, test } from '../test/test.entry-point.ts';
import {
    getCompositeAssertionReferenceRecord,
    unknownSourceLocation
} from '../engine/assertion-protocol.entry-point.ts';
import { sameType, callableWith } from './type-test.entry-point.ts';

export const testNode = suite('native type assertion references', [
    test('fails ordinary execution instead of reporting a successful erased check', function (scope) {
        const reference = sameType<string, number>();
        scope.assert.throws(function () {
            return getCompositeAssertionReferenceRecord(reference).run({
                message: null,
                parameters: [],
                source: 'assert',
                sourceLocations: [ unknownSourceLocation ]
            });
        }, { message: /requires the type-test adapter/u });
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
        }, { message: /not toBe/u });
        scope.assert.throws(function () {
            return getCompositeAssertionReferenceRecord(callableWith.withActual).run({
                message: null,
                parameters: [ function () {
                    return 1;
                } ],
                source: 'assert',
                sourceLocations: [ unknownSourceLocation ]
            });
        }, { message: /requires the type-test adapter/u });
        return scope.assert.collect();
    })
]);

await runIfMain(import.meta, testNode);
