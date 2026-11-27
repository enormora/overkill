import { suite, test } from '@overkill-dev/test-type-authoring';
import { sameType } from '@overkill-dev/type-test';
import { ReporterSinkConflictError } from './engine.entry-point.ts';

export const testNode = suite('ReporterSinkConflictError', [
    test('is exported as a typed reporter configuration failure', function (typeScope) {
        typeScope.assert(sameType.withActual<ReporterSinkConflictError>(), new ReporterSinkConflictError('conflict'));
        return typeScope.assert.collect();
    })
]);
