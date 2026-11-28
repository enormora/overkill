import { suite, test } from '@overkill-dev/test';
import { sameType } from '@overkill-dev/type-test';
import type { DefinedReporter, RealTimeReporter } from '../engine/engine.entry-point.ts';
import { isEqualTo } from '../../test-support/type-relations.ts';
import { createDotReporter } from './reporter-dot.entry-point.ts';

export const testNode = suite('Dot reporter output contract', [
    test('returns the public real-time reporter contract', function (scope) {
        scope.assert(
            sameType.withActual<true>(),
            isEqualTo<DefinedReporter<RealTimeReporter>>()(createDotReporter())
        );
        return scope.assert.collect();
    })
]);
