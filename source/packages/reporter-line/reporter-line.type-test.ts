import { isEqualTo } from '../../test-support/type-relations.ts';
import { suite, test } from '@overkill-dev/test';
import { sameType } from '@overkill-dev/type-test';
import type { DefinedReporter, FinalResultReporter, RealTimeReporter } from '../engine/engine.entry-point.ts';
import {
    createLineProgressReporter,
    createLineReporter,
    createLineTreeReporter
} from './reporter-line.entry-point.ts';

export const testNode = suite('createLineReporter', [
    test('returns the public real-time reporter contract', function (typeScope) {
        typeScope.assert(
            sameType.withActual<true>(),
            isEqualTo<DefinedReporter<RealTimeReporter>>()(createLineReporter())
        );
        typeScope.assert(
            sameType.withActual<true>(),
            isEqualTo<DefinedReporter<RealTimeReporter>>()(createLineReporter({ verbose: true }))
        );
        return typeScope.assert.collect();
    }),
    test('exposes progress and tree presentation variants', function (typeScope) {
        typeScope.assert(
            sameType.withActual<true>(),
            isEqualTo<DefinedReporter<RealTimeReporter>>()(createLineProgressReporter())
        );
        typeScope.assert(
            sameType.withActual<true>(),
            isEqualTo<DefinedReporter<RealTimeReporter>>()(
                createLineProgressReporter({ showPassing: false, verbose: true })
            )
        );
        typeScope.assert(
            sameType.withActual<true>(),
            isEqualTo<DefinedReporter<FinalResultReporter>>()(createLineTreeReporter())
        );
        typeScope.assert(
            sameType.withActual<true>(),
            isEqualTo<DefinedReporter<FinalResultReporter>>()(
                createLineTreeReporter({ showPassing: false, verbose: true })
            )
        );
        return typeScope.assert.collect();
    })
]);
