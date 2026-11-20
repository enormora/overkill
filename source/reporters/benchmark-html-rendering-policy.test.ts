import { type TestNode, table, type TestScope, suite, test } from '@overkill-dev/test';

import { benchmarkHtmlFixture } from '../test-support/benchmark-html-fixture.ts';
import { validateReporterRunFacts } from '../engine/reporter.ts';
import { createBenchmarkHtmlReporter } from './benchmark-html-reporter.ts';
import { createBenchmarkHtmlReport } from './benchmark-html-model.ts';
import { renderBenchmarkHtml } from './benchmark-html-document.ts';
import type { BenchmarkHtmlReport } from './benchmark-html-data.ts';

function unboundedBenchmarkHtml(scope: TestScope): string {
    const result = benchmarkHtmlFixture('unbounded');
    const measured = result.perTest[0];
    scope.require.defined(measured);
    const { benchmark } = measured;
    scope.require.defined(benchmark);
    const budget = benchmark.budgets[0];
    scope.require.defined(budget);
    return renderBenchmarkHtml(
        createBenchmarkHtmlReport({
            result: {
                ...result,
                perTest: [ {
                    ...measured,
                    benchmark: {
                        ...benchmark,
                        budgets: [ {
                            ...budget,
                            minimum: 1,
                            maximum: null,
                            estimate: null,
                            interval: { lower: null, upper: null },
                            precise: false,
                            decision: 'undecided' as const
                        } ]
                    }
                } ]
            },
            context: { id: null, startedAt: null, facts: null }
        }),
        ''
    );
}
function lifecycleModel(): BenchmarkHtmlReport {
    const result = benchmarkHtmlFixture('lifecycle');
    const measuredTest = result.perTest[0];
    if (measuredTest?.benchmark === null || measuredTest === undefined) {
        throw new Error('Missing benchmark fixture.');
    }
    const target = {
        name: 'recorded target',
        version: '1',
        scope: 'case',
        clock: 'monotonic',
        instance: 'recorded',
        document: null,
        semantics: {}
    };
    const measurement = {
        version: 1 as const,
        identity: { target, collectors: [] },
        omitted: 0,
        invocations: [ {
            invocation: {
                execution: 'recorded',
                work: measuredTest.workId,
                attempt: { index: 0 },
                phase: 'measured' as const,
                index: 0
            },
            target,
            collectors: [],
            status: 'complete' as const,
            errors: [],
            durationMicroseconds: 12,
            lifecycleMicroseconds: 14
        } ]
    };
    const benchmark = {
        ...measuredTest.benchmark,
        lifecycle: {
            version: 3 as const,
            measurement,
            garbageCollection: { mode: 'after-sample' as const, completed: 36, failures: 0 },
            policy: {
                garbageCollection: 'after-sample' as const,
                warmupSamples: 32,
                cooldown: { mode: 'off' as const }
            },
            warmup: {
                samples: 32,
                metrics: measuredTest.benchmark.metrics,
                rawSamples: measuredTest.benchmark.rawSamples
            },
            cleanup: { callbacks: 36, failures: 0 },
            cooldown: { mode: 'off' as const }
        }
    };
    return createBenchmarkHtmlReport({
        result: { ...result, perTest: [ { ...measuredTest, benchmark } ] },
        context: { id: null, startedAt: null, facts: null }
    });
}
export const testNode: TestNode = suite('benchmark HTML rendering', [
    table({
        title: 'renders garbage collection evidence',
        cases: [ null, { mode: 'off' as const } ],
        caseTitle(garbageCollection) {
            return `renders garbage collection evidence ${garbageCollection?.mode ?? 'unavailable'}`;
        },
        test(scope) {
            const require: typeof scope.require = scope.require;

            const garbageCollection = scope.parameters;

            const report = lifecycleModel();
            const first = report.cases[0];
            require.defined(first);
            require.defined(first.lifecycle);
            const html = renderBenchmarkHtml({
                ...report,
                cases: [ { ...first, lifecycle: { ...first.lifecycle, garbageCollection } } ]
            }, '');
            scope.assert.includes(
                html,
                `<td>${garbageCollection?.mode ?? 'unavailable'}</td><td>unavailable</td><td>unavailable</td>`
            );
            scope.assert.includes(
                html,
                '<td>recorded target</td><td>monotonic</td><td>12</td><td>14</td><td>complete</td>'
            );
            return scope.assert.collect();
        }
    }),
    test('renders recorded cooldown outcomes and durations', function (scope: TestScope) {
        const report = lifecycleModel();
        const first = report.cases[0];
        scope.require.defined(first);
        scope.require.defined(first.lifecycle);
        const lifecycle = {
            ...first.lifecycle,
            policy: {
                ...first.lifecycle.policy,
                cooldown: { mode: 'runtime' as const, maximumEventLoopUtilization: 0.1, timeoutMilliseconds: 1000 }
            },
            cooldown: {
                mode: 'runtime' as const,
                strategy: 'event-loop-utilization-v1' as const,
                completed: 1,
                windows: 1,
                durationMicroseconds: 250,
                lastUtilization: 0.01,
                outcome: 'settled' as const
            }
        };
        const html = renderBenchmarkHtml({ ...report, cases: [ { ...first, lifecycle } ] }, '');
        scope.assert.includes(html, '<td>settled</td><td>250</td>');
        return scope.assert.collect();
    }),
    test('identifies recorded timelines that contain no events', function (scope) {
        const report = lifecycleModel();
        const timelines = [ {
            label: 'empty',
            evidence: {
                version: 1 as const,
                events: 0,
                omitted: 0,
                status: 'recorded' as const,
                reference: null,
                reason: null
            },
            events: []
        } ];
        const html = renderBenchmarkHtml({ ...report, charts: { ...report.charts, timelines } }, '');
        scope.assert.includes(html, 'No timeline events are available.');
        return scope.assert.collect();
    }),
    test('renders warmup and cleanup separately from measured distributions', function (scope) {
        const html = renderBenchmarkHtml(lifecycleModel(), '');
        scope.assert.includes(html, 'Warmup samples');
        scope.assert.includes(
            html,
            '<td>32</td><td>36</td><td>0</td><td>after-sample</td><td>36</td><td>0</td><td>off</td>'
        );
        scope.assert.includes(html, 'Warmup metric');
        scope.assert.includes(html, 'Warmup raw evidence: recorded');
        return scope.assert.collect();
    }),
    test('identifies historical lifecycle evidence as unavailable', function (scope) {
        const html = renderBenchmarkHtml(
            createBenchmarkHtmlReport({
                result: benchmarkHtmlFixture('historical'),
                context: { id: null, startedAt: null, facts: null }
            }),
            ''
        );
        scope.assert.includes(html, 'Lifecycle evidence unavailable.');
        return scope.assert.collect();
    }),
    test('rejects blank output paths and missing benchmark evidence', function (scope) {
        scope.assert.throws(function () {
            createBenchmarkHtmlReporter({ outputFile: ' '.repeat(3) });
        }, { message: 'Benchmark HTML report outputFile must not be blank.' });
        const result = benchmarkHtmlFixture('unmeasured');
        scope.assert.throws(function () {
            createBenchmarkHtmlReport({
                result: { ...result, artifacts: [], perTest: [] },
                context: { id: null, startedAt: null, facts: null }
            });
        }, { message: 'Benchmark HTML reporter requires benchmark result evidence.' });
        return scope.assert.collect();
    }),
    test('renders open budget intervals without inferred estimates', function (scope) {
        const html = unboundedBenchmarkHtml(scope);
        scope.assert.includes(
            html,
            '<td>unavailable</td><td>-unbounded</td><td>unbounded</td><td>1</td><td>unbounded</td>'
        );
        scope.assert.includes(html, '<td>false</td><td>undecided</td>');
        return scope.assert.collect();
    }),
    test('retains authoritative intervals without embedding raw observations', function (scope: TestScope) {
        const report = createBenchmarkHtmlReport({
            result: benchmarkHtmlFixture('latency'),
            context: { id: null, startedAt: null, facts: null }
        });
        const row = report.charts.groups[0]?.rows[0];
        scope.require.defined(row);
        scope.assert.deepEqual(row.box, [ 1, 1.75, 2.5, 3.25, 4 ]);
        scope.assert.equal(row.budgets[0]?.decision, 'pass');
        const budget = row.budgets[0];
        scope.require.defined(budget);
        scope.assert.deepEqual(budget.interval, { lower: 1, upper: 4 });
        scope.assert.equal(JSON.stringify(report).includes('"availability":"available"'), false);
        return scope.assert.collect();
    }),
    test('escapes untrusted names in HTML and embedded chart scripts', function (scope) {
        const report = createBenchmarkHtmlReport({
            result: benchmarkHtmlFixture('</script><script>attack()</script>'),
            context: { id: null, startedAt: null, facts: null }
        });
        const html = renderBenchmarkHtml(report, 'window.renderBenchmarkCharts = () => {};');
        scope.assert.includes(html, '&lt;/script&gt;');
        scope.assert.equal(html.includes('</script><script>attack()'), false);
        scope.assert.includes(html, 'recorded intervals');
        scope.assert.includes(html, 'noscript');
        return scope.assert.collect();
    }),
    test('rejects non-benchmark facts before creating output', function (scope) {
        const reporter = createBenchmarkHtmlReporter({ outputFile: 'target/unwanted-benchmark.html' });
        scope.assert.throws(function () {
            validateReporterRunFacts(reporter, { execution: { testFamily: 'microtest' } });
        }, { message: 'Benchmark HTML reporter requires a benchmark profile.' });
        return scope.assert.collect();
    })
]);
