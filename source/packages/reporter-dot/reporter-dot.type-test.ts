import { suite, test } from '@overkill-dev/test-type-authoring';
import { sameType } from '@overkill-dev/type-test';
import type { DefinedReporter, RealTimeReporter } from '../engine/engine.entry-point.ts';
import { isEqualTo } from '../../test-support/type-relations.ts';
import { createDotReporter } from './reporter-dot.entry-point.ts';

export const testNode = suite('createDotReporter', [
    test('returns the public real-time reporter contract', function (typeScope) {
        typeScope.assert(
            sameType.withActual<true>(),
            isEqualTo<DefinedReporter<RealTimeReporter>>()(createDotReporter())
        );
        return typeScope.assert.collect();
    })
]);
