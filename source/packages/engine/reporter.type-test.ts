import { suite, test } from '../test/test.entry-point.ts';
import { sameType } from '../type-test/type-test.entry-point.ts';
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
