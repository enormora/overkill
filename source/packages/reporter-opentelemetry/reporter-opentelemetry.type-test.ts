import { isEqualTo } from '../../test-support/type-relations.ts';
import { suite, test } from '@overkill-dev/test';
import { sameType } from '@overkill-dev/type-test';
import type { DefinedReporter, FinalResultReporter } from '../engine/engine.entry-point.ts';
import { createOpenTelemetryReporter } from './reporter-opentelemetry.entry-point.ts';

export const testNode = suite('createOpenTelemetryReporter', [
    test('returns the public final-result reporter contract', function (typeScope) {
        typeScope.assert(
            sameType.withActual<true>(),
            isEqualTo<DefinedReporter<FinalResultReporter>>()(
                createOpenTelemetryReporter({ outputFile: 'traces.jsonl' })
            )
        );
        return typeScope.assert.collect();
    })
]);
