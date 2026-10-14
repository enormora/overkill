import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { benchmarkHtmlFixture } from '../test-support/benchmark-html-fixture.ts';
import { performanceReportArtifact } from '../baselines/performance-report.ts';
import type { PerformanceMetricComparison } from '../baselines/performance-adapter.ts';
import type { PerformanceObservationEvidence } from '../baselines/performance-presentation.ts';
import type { BaselineChange } from '../baselines/performance-baseline.ts';
import { createBenchmarkHtmlReport } from './benchmark-html-model.ts';
import type { BenchmarkHtmlReport } from './benchmark-html-data.ts';
import { renderBenchmarkHtml } from './benchmark-html-document.ts';

const calibration = { kind: 'comparable', machineClass: 'test', context: {}, metadata: {} } as const;
const observation = {
    kind: 'observed',
    actual: { calibration, value: 42 },
    expected: { calibration, value: 1 },
    comparison: { kind: 'match' }
} as const;
function policyReport(
    metrics: readonly PerformanceMetricComparison[] | null,
    observed: PerformanceObservationEvidence,
    changes: readonly BaselineChange[]
): BenchmarkHtmlReport {
    const result = benchmarkHtmlFixture('baseline policy');
    const measured = result.perTest[0];
    if (measured === undefined) {
        throw new Error('Expected benchmark fixture.');
    }
    const artifact = performanceReportArtifact({
        result,
        capturedAtMicroseconds: 0,
        maxBytes: 4096,
        report: {
            version: 2,
            calibration,
            changes,
            writeOutcome: { kind: 'read-only' },
            comparisons: [ {
                adapter: 'latency',
                work: measured.workId,
                observation: observed,
                presentation: metrics === null
                    ? { kind: 'unavailable', reason: 'Adapter does not describe metrics.' }
                    : { kind: 'available', metrics }
            } ]
        }
    });
    return createBenchmarkHtmlReport({ ...result, artifacts: [ ...result.artifacts, artifact ] });
}
function baselineReport(metrics: readonly PerformanceMetricComparison[]): BenchmarkHtmlReport {
    return policyReport(metrics, observation, []);
}
export const testNode = suite('benchmark HTML baseline comparisons', [
    test('retains policy diagnostics without inventing charts for untyped adapters', function (scope: TestScope) {
        const report = policyReport(null, observation, []);
        scope.assert.deepEqual(report.charts.baselines, []);
        scope.assert.includes(report.baselineDetails, 'Adapter does not describe metrics.');
        scope.assert.includes(report.baselineDetails, '"kind": "match"');
        return scope.assert.collect();
    }),
    test('keeps unavailable observations and missing baselines explicit', function (scope: TestScope) {
        const metric = {
            name: 'latency',
            unit: 'ms',
            scale: { kind: 'raw' },
            actual: null,
            expected: { kind: 'missing' }
        } as const;
        for (
            const observed of [
                { kind: 'not-applicable' },
                { kind: 'not-evaluated', reason: 'Calibration unavailable.' },
                { kind: 'error', reason: 'Observation failed.' }
            ] as const
        ) {
            scope.assert.equal(policyReport([ metric ], observed, []).charts.baselines[0]?.outcome, observed.kind);
        }
        scope.assert.equal(
            policyReport([ metric ], {
                ...observation,
                expected: null,
                comparison: null
            }, [])
                .charts
                .baselines[0]
                ?.outcome,
            'missing baseline'
        );
        scope.assert.equal(
            policyReport([ metric ], {
                ...observation,
                comparison: null
            }, [])
                .charts
                .baselines[0]
                ?.outcome,
            'no change proposed'
        );
        return scope.assert.collect();
    }),
    test('reports proposed changes with their write outcome', function (scope: TestScope) {
        const result = benchmarkHtmlFixture('baseline policy');
        const measured = result.perTest[0];
        scope.require.defined(measured);
        const metric = {
            name: 'latency',
            unit: 'ms',
            scale: { kind: 'raw' },
            actual: 42,
            expected: { kind: 'missing' }
        } as const;
        const change: BaselineChange = {
            kind: 'create',
            baseline: {
                adapter: 'latency',
                expected: observation.actual,
                profile: 'benchmark',
                subtype: 'performance-baseline',
                version: 1,
                work: measured.workId
            }
        };
        scope.assert.equal(
            policyReport([ metric ], { ...observation, comparison: null }, [ change ])
                .charts
                .baselines[0]
                ?.outcome,
            'create / read-only'
        );
        scope.assert.equal(
            policyReport([ metric ], { ...observation, comparison: null }, [
                { ...change, baseline: { ...change.baseline, adapter: 'other' } }
            ])
                .charts
                .baselines[0]
                ?.outcome,
            'no change proposed'
        );
        return scope.assert.collect();
    }),
    test('renders unavailable values and avoids arithmetic overflow', function (scope: TestScope) {
        const report = baselineReport([
            {
                name: 'missing',
                unit: 'ms',
                scale: { kind: 'raw' },
                actual: null,
                expected: { kind: 'value', value: 1 }
            },
            {
                name: 'overflow',
                unit: 'ms',
                scale: { kind: 'raw' },
                actual: Number.MAX_VALUE,
                expected: { kind: 'value', value: -Number.MAX_VALUE }
            },
            {
                name: 'percent overflow',
                unit: 'ms',
                scale: { kind: 'raw' },
                actual: 1,
                expected: { kind: 'value', value: Number.MIN_VALUE }
            },
            {
                name: 'open range',
                unit: 'ms',
                scale: { kind: 'raw' },
                actual: 3,
                expected: { kind: 'range', minimum: null, maximum: 5 }
            }
        ]);
        const html = renderBenchmarkHtml(report, '');
        scope.assert.includes(html, '<td>unavailable</td>');
        scope.assert.equal(html.includes('Infinity'), false);
        scope.assert.equal(html.includes('NaN'), false);
        return scope.assert.collect();
    }),
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
