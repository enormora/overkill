import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { benchmarkHtmlFixture } from '../test-support/benchmark-html-fixture.ts';
import { performanceReportArtifact } from '../baselines/performance-report.ts';
import type { PerformanceMetricComparison } from '../baselines/performance-adapter.ts';
import { createBenchmarkHtmlReport } from './benchmark-html-model.ts';
import type { BenchmarkHtmlReport } from './benchmark-html-data.ts';
import { renderBenchmarkHtml } from './benchmark-html-document.ts';

function baselineReport(metrics: readonly PerformanceMetricComparison[]): BenchmarkHtmlReport {
    const result = benchmarkHtmlFixture('baseline policy');
    const measured = result.perTest[0];
    if (measured === undefined) {
        throw new Error('Expected benchmark fixture.');
    }
    const calibration = { kind: 'comparable', machineClass: 'test', context: {}, metadata: {} } as const;
    const artifact = performanceReportArtifact({
        result,
        capturedAtMicroseconds: 0,
        maxBytes: 4096,
        report: {
            version: 2,
            calibration,
            changes: [],
            writeOutcome: { kind: 'read-only' },
            comparisons: [ {
                adapter: 'latency',
                work: measured.workId,
                observation: {
                    kind: 'observed',
                    actual: { calibration, value: 42 },
                    expected: { calibration, value: 1 },
                    comparison: { kind: 'match' }
                },
                presentation: { kind: 'available', metrics }
            } ]
        }
    });
    return createBenchmarkHtmlReport({ ...result, artifacts: [ ...result.artifacts, artifact ] });
}
export const testNode = suite('benchmark HTML baseline comparisons', [
    test('displays adapter policy independently of numeric chart deltas', function (scope: TestScope) {
        const report = baselineReport([ {
            name: 'latency',
            unit: 'ms',
            scale: { kind: 'raw' },
            actual: 42,
            expected: { kind: 'value', value: 1 }
        } ]);
        scope.assert.equal(report.charts.baselines[0]?.outcome, 'match');
        const html = renderBenchmarkHtml(report, '');
        scope.assert.includes(html, '<td>41</td>');
        scope.assert.includes(html, '<td>4100</td>');
        scope.assert.includes(html, '<td>match</td>');
        return scope.assert.collect();
    }),
    test('shows range distances and leaves zero-reference percentages unavailable', function (scope: TestScope) {
        const report = baselineReport([
            {
                name: 'range',
                unit: 'ms',
                scale: { kind: 'raw' },
                actual: 3,
                expected: { kind: 'range', minimum: 1, maximum: 5 }
            },
            { name: 'zero', unit: 'ms', scale: { kind: 'raw' }, actual: 3, expected: { kind: 'value', value: 0 } }
        ]);
        const html = renderBenchmarkHtml(report, '');
        scope.assert.includes(html, 'Delta from minimum');
        scope.assert.includes(html, '<td>2</td><td>-2</td>');
        scope.assert.equal(html.includes('Infinity'), false);
        return scope.assert.collect();
    }),
    test('keeps raw and normalized values in separate chart groups', function (scope: TestScope) {
        const report = baselineReport([
            { name: 'latency', unit: 'ms', scale: { kind: 'raw' }, actual: 3, expected: { kind: 'missing' } },
            {
                name: 'latency',
                unit: 'ms',
                scale: { kind: 'normalized', description: 'reference CPU' },
                actual: 2,
                expected: { kind: 'value', value: 1 }
            }
        ]);
        scope.assert.notEqual(report.charts.baselines[0]?.group, report.charts.baselines[1]?.group);
        scope.assert.includes(renderBenchmarkHtml(report, ''), 'reference CPU');
        return scope.assert.collect();
    })
]);
