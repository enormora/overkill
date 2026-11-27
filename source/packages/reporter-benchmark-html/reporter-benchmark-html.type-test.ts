import { isEqualTo } from '../../test-support/type-relations.ts';
import { test } from '@overkill-dev/test';
import { rejectsCall, sameType } from '@overkill-dev/type-test';
import type { DefinedReporter, FinalResultReporter } from '../engine/engine.entry-point.ts';
import { createBenchmarkHtmlReporter, type BenchmarkHtmlReporterSinks } from './reporter-benchmark-html.entry-point.ts';

export const testNode = test('defines a final-result reporter with one file sink', function (typeScope) {
    typeScope.assert(
        sameType.withActual<true>(),
        isEqualTo<DefinedReporter<FinalResultReporter<BenchmarkHtmlReporterSinks>>>()(
            createBenchmarkHtmlReporter({ outputFile: 'report.html' })
        )
    );
    typeScope.assert(rejectsCall('argument-type'), () => createBenchmarkHtmlReporter({}));
    return typeScope.assert.collect();
});
