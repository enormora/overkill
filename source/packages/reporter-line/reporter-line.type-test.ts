import { suite, test } from '../test/test.entry-point.ts';
import { sameType } from '../type-test/type-test.entry-point.ts';
import type { DefinedReporter, FinalResultReporter, RealTimeReporter } from '../engine/engine.entry-point.ts';
import { isEqualTo } from '../../test-support/type-relations.ts';
import {
    createLineProgressReporter,
    createLineReporter,
    createLineTreeReporter
} from './reporter-line.entry-point.ts';

export const testNode = suite('Line reporter modes and output contracts', [
    test('returns the public real-time reporter contract', function (scope) {
        scope.assert(
            sameType.withActual<true>(),
            isEqualTo<DefinedReporter<RealTimeReporter>>()(createLineReporter())
        );
        scope.assert(
            sameType.withActual<true>(),
            isEqualTo<DefinedReporter<RealTimeReporter>>()(createLineReporter({ verbose: true }))
        );
        return scope.assert.collect();
    }),
    test('exposes progress and tree presentation variants', function (scope) {
        scope.assert(
            sameType.withActual<true>(),
            isEqualTo<DefinedReporter<RealTimeReporter>>()(createLineProgressReporter())
        );
        scope.assert(
            sameType.withActual<true>(),
            isEqualTo<DefinedReporter<RealTimeReporter>>()(
                createLineProgressReporter({ showPassing: false, verbose: true })
            )
        );
        scope.assert(
            sameType.withActual<true>(),
            isEqualTo<DefinedReporter<FinalResultReporter>>()(createLineTreeReporter())
        );
        scope.assert(
            sameType.withActual<true>(),
            isEqualTo<DefinedReporter<FinalResultReporter>>()(
                createLineTreeReporter({ showPassing: false, verbose: true })
            )
        );
        return scope.assert.collect();
    })
]);
