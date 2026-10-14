import { expect, test } from 'tstyche';
import type { DefinedReporter, FinalResultReporter } from '../engine/engine.entry-point.ts';
import { createBenchmarkHtmlReporter, type BenchmarkHtmlReporterSinks } from './reporter-benchmark-html.entry-point.ts';

test('defines a final-result reporter with one file sink', function () {
    expect(createBenchmarkHtmlReporter({ outputFile: 'report.html' }))
        .type
        .toBe<DefinedReporter<FinalResultReporter<BenchmarkHtmlReporterSinks>>>();
    expect(createBenchmarkHtmlReporter).type.not.toBeCallableWith({});
});
