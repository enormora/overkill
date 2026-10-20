import type { BenchmarkExecutionResult } from '../engine/benchmark-result.ts';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { benchmarkHtmlFixture } from '../test-support/benchmark-html-fixture.ts';
import { calibrationSnapshot } from '../test-support/calibration-fixture.ts';
import { benchmarkMetricGroups } from '../reporters/benchmark-html-metrics.ts';
import { summarizeNormalization } from './normalization-summaries.ts';

function normalizedResult(): BenchmarkExecutionResult {
    const result = benchmarkHtmlFixture('normalization summary').perTest[0]?.benchmark;
    if (result === undefined || result === null) {
        throw new Error('Expected benchmark fixture.');
    }
    const actual = calibrationSnapshot(Array.from({ length: 128 }, function () {
        return 100;
    }));
    const reference = {
        ...actual,
        samples: actual.samples.map(function () {
            return 200;
        })
    };
    return {
        ...result,
        normalization: {
            version: 1,
            comparability: { kind: 'comparable' },
            calibrations: [ actual ],
            metrics: {
                latency: {
                    actual,
                    reference,
                    budgetReference: actual,
                    scaling: 'proportional',
                    source: 'fixed',
                    factor: null,
                    summary: null,
                    budgets: []
                }
            }
        }
    };
}
function incompleteDisplay(missing: 'factor' | 'summary'): BenchmarkExecutionResult {
    const result = normalizedResult();
    const { normalization } = result;
    const metric = normalization?.metrics.latency;
    if (normalization === null || metric === undefined) {
        throw new Error('Expected normalized metric.');
    }
    return {
        ...result,
        normalization: {
            ...normalization,
            metrics: {
                latency: {
                    ...metric,
                    summary: result.metrics.latency ?? null,
                    factor: { estimate: 2, lower: 2, upper: 2 },
                    [missing]: null
                }
            }
        }
    };
}
export const testNode = suite('normalization summaries', [
    ...([ 'summary', 'factor' ] as const).map(function incompleteDisplayCase(missing) {
        return test(`keeps only raw charts when the normalized ${missing} is unavailable`, function (scope: TestScope) {
            const fixture = benchmarkHtmlFixture('incomplete normalization');
            const measured = fixture.perTest[0];
            scope.require.defined(measured);
            const benchmark = incompleteDisplay(missing);
            const groups = benchmarkMetricGroups({ ...fixture, perTest: [ { ...measured, benchmark } ] });
            scope.assert.equal(groups.length, 1);
            scope.assert.equal(groups[0]?.rows[0]?.summary, benchmark.metrics.latency);
            scope.assert.deepEqual({ budgets: groups[0]?.rows[0]?.budgets }, { budgets: [] });
            return scope.assert.collect();
        });
    }),
    test('scales displayed observations and budgets while retaining raw evidence', function (scope: TestScope) {
        const result = normalizedResult();
        const evidence = summarizeNormalization(result, 1);
        scope.assert.deepEqual({ summary: evidence?.metrics.latency?.summary }, {
            summary: {
                ...result.metrics.latency,
                minimum: 2,
                maximum: 8,
                mean: 5,
                median: 5
            }
        });
        scope.assert.deepEqual({ budget: evidence?.metrics.latency?.budgets[0] }, {
            budget: {
                ...result.budgets[0],
                minimum: null,
                maximum: 10,
                estimate: 5,
                interval: { lower: 2, upper: 8 }
            }
        });
        scope.assert.equal(result.metrics.latency?.median, 2.5);
        return scope.assert.collect();
    }),
    test('retains absent metrics and observations instead of inventing summaries', function (scope: TestScope) {
        const result = normalizedResult();
        const absent = summarizeNormalization({ ...result, metrics: {}, budgets: [] }, 0);
        scope.assert.equal(absent?.metrics.latency?.summary, null);
        scope.assert.deepEqual({ budgets: absent?.metrics.latency?.budgets }, { budgets: [] });
        scope.assert.equal(summarizeNormalization({ ...result, normalization: null }, 1), null);
        return scope.assert.collect();
    }),
    test('marks overflowing displays non-comparable while preserving raw observations', function (scope: TestScope) {
        const result = normalizedResult();
        const metric = result.metrics.latency;
        scope.require.defined(metric);
        const raw = { ...result, metrics: { latency: { ...metric, maximum: Number.MAX_VALUE } } };
        const evidence = summarizeNormalization(raw, 1);
        scope.assert.deepEqual({ comparability: evidence?.comparability }, {
            comparability: {
                kind: 'non-comparable',
                reason: 'Normalized benchmark value is not finite.'
            }
        });
        scope.assert.equal(evidence?.metrics, result.normalization?.metrics);
        scope.assert.equal(raw.metrics.latency.maximum, Number.MAX_VALUE);
        return scope.assert.collect();
    })
]);
