import { suite, test } from '@overkill-dev/test';
import { sameType } from '@overkill-dev/type-test';
import { isEqualTo } from '../../test-support/type-relations.ts';
import { ReporterSinkConflictError } from './engine.entry-point.ts';

export const testNode = suite('ReporterSinkConflictError', [
    test('is exported as a typed reporter configuration failure', function (scope) {
        scope.assert(
            sameType.withActual<true>(),
            isEqualTo<ReporterSinkConflictError>()(new ReporterSinkConflictError('conflict'))
        );
        return scope.assert.collect();
    })
]);
