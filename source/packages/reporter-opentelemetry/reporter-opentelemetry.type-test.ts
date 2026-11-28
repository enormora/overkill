import { suite, test } from '@overkill-dev/test';
import { sameType } from '@overkill-dev/type-test';
import type { DefinedReporter, FinalResultReporter } from '../engine/engine.entry-point.ts';
import { isEqualTo } from '../../test-support/type-relations.ts';
import { createOpenTelemetryReporter } from './reporter-opentelemetry.entry-point.ts';

export const testNode = suite('OpenTelemetry reporting contract', [
    test('returns the public final-result reporter contract', function (scope) {
        scope.assert(
            sameType.withActual<true>(),
            isEqualTo<DefinedReporter<FinalResultReporter>>()(
                createOpenTelemetryReporter({ outputFile: 'traces.jsonl' })
            )
        );
        return scope.assert.collect();
    })
]);
