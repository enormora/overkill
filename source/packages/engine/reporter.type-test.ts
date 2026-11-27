import { suite, test } from '../../../tools/type-tests/authoring.entry-point.ts';
import { sameType } from '../../../tools/type-tests/relations.entry-point.ts';
import { isEqualTo } from '../../test-support/type-relations.ts';
import { ReporterSinkConflictError } from './engine.entry-point.ts';

export const testNode = suite('ReporterSinkConflictError', [
    test('is exported as a typed reporter configuration failure', function (typeScope) {
        typeScope.assert(
            sameType.withActual<true>(),
            isEqualTo<ReporterSinkConflictError>()(new ReporterSinkConflictError('conflict'))
        );
        return typeScope.assert.collect();
    })
]);
