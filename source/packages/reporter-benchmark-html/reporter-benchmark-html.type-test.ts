import { test } from '@overkill-dev/test';
import { rejectsCall, sameType } from '@overkill-dev/type-test';
import type { DefinedReporter, FinalResultReporter } from '../engine/engine.entry-point.ts';
import { isEqualTo } from '../../test-support/type-relations.ts';
import { createBenchmarkHtmlReporter, type BenchmarkHtmlReporterSinks } from './reporter-benchmark-html.entry-point.ts';

export const testNode = test('defines a final-result reporter with one file sink', function (scope) {
    scope.assert(
        sameType.withActual<true>(),
        isEqualTo<DefinedReporter<FinalResultReporter<BenchmarkHtmlReporterSinks>>>()(
            createBenchmarkHtmlReporter({ outputFile: 'report.html' })
        )
    );
    scope.assert(rejectsCall('argument-type'), function () {
        return createBenchmarkHtmlReporter({});
    });
    return scope.assert.collect();
});
