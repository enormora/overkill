import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { createReportingContext } from '../engine/reporting-context.ts';
import { validateReporterRunFacts } from '../engine/reporter.ts';
import { benchmarkHtmlFixture } from '../test-support/benchmark-html-fixture.ts';
import { createBenchmarkHtmlReport } from './benchmark-html-model.ts';
import { renderBenchmarkHtml } from './benchmark-html-document.ts';
import { createBenchmarkHtmlReporter } from './benchmark-html-reporter.ts';

async function outputDirectory(scope: TestScope): Promise<string> {
    const directory = await mkdtemp('target/benchmark-html-test-');
    scope.cleanup(async function removeOutput() {
        await rm(directory, { recursive: true, force: true });
    });
    return directory;
}
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
        }),
        ''
    );
}
function lifecycleReport(): string {
    const result = benchmarkHtmlFixture('lifecycle');
    const measuredTest = result.perTest[0];
    if (measuredTest?.benchmark === null || measuredTest === undefined) {
        throw new Error('Missing benchmark fixture.');
    }
    const benchmark = {
        ...measuredTest.benchmark,
        lifecycle: {
            version: 2 as const,
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
    return renderBenchmarkHtml(
        createBenchmarkHtmlReport({ ...result, perTest: [ { ...measuredTest, benchmark } ] }),
        ''
    );
}

export const testNode = suite('benchmark HTML reporter', [
    test('renders warmup and cleanup separately from measured distributions', function (scope: TestScope) {
        const html = lifecycleReport();
        scope.assert.includes(html, 'Warmup samples');
        scope.assert.includes(
            html,
            '<td>32</td><td>36</td><td>0</td><td>after-sample</td><td>36</td><td>0</td><td>off</td>'
        );
        scope.assert.includes(html, 'Warmup metric');
        scope.assert.includes(html, 'Warmup raw evidence: recorded');
        return scope.assert.collect();
    }),
    test('identifies historical lifecycle evidence as unavailable', function (scope: TestScope) {
        const html = renderBenchmarkHtml(createBenchmarkHtmlReport(benchmarkHtmlFixture('historical')), '');
        scope.assert.includes(html, 'Lifecycle evidence unavailable.');
        return scope.assert.collect();
    }),
    test('rejects blank output paths and missing benchmark evidence', function (scope: TestScope) {
        scope.assert.throws(function () {
            createBenchmarkHtmlReporter({ outputFile: ' '.repeat(3) });
        }, { message: 'Benchmark HTML report outputFile must not be blank.' });
        const result = benchmarkHtmlFixture('unmeasured');
        scope.assert.throws(function () {
            createBenchmarkHtmlReport({ ...result, artifacts: [], perTest: [] });
        }, { message: 'Benchmark HTML reporter requires benchmark result evidence.' });
        return scope.assert.collect();
    }),
    test('renders open budget intervals without inferred estimates', function (scope: TestScope) {
        const html = unboundedBenchmarkHtml(scope);
        scope.assert.includes(
            html,
            '<td>unavailable</td><td>-unbounded</td><td>unbounded</td><td>1</td><td>unbounded</td>'
        );
        scope.assert.includes(html, '<td>false</td><td>undecided</td>');
        return scope.assert.collect();
    }),
    test('retains authoritative intervals without embedding raw observations', function (scope: TestScope) {
        const report = createBenchmarkHtmlReport(benchmarkHtmlFixture('latency'));
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
    test('escapes untrusted names in HTML and embedded chart scripts', function (scope: TestScope) {
        const report = createBenchmarkHtmlReport(benchmarkHtmlFixture('</script><script>attack()</script>'));
        const html = renderBenchmarkHtml(report, 'window.renderBenchmarkCharts = () => {};');
        scope.assert.includes(html, '&lt;/script&gt;');
        scope.assert.equal(html.includes('</script><script>attack()'), false);
        scope.assert.includes(html, 'recorded intervals');
        scope.assert.includes(html, 'noscript');
        return scope.assert.collect();
    }),
    test('rejects non-benchmark facts before creating output', function (scope: TestScope) {
        const reporter = createBenchmarkHtmlReporter({ outputFile: 'target/unwanted-benchmark.html' });
        scope.assert.throws(function () {
            validateReporterRunFacts(reporter, { execution: { testFamily: 'microtest' } });
        }, { message: 'Benchmark HTML reporter requires a benchmark profile.' });
        return scope.assert.collect();
    }),
    test('writes a self-contained report and replaces it atomically', async function (scope: TestScope) {
        const outputFile = join(await outputDirectory(scope), 'nested/report.html');
        const reporter = createBenchmarkHtmlReporter({ outputFile })(
            createReportingContext({ projectRoot: process.cwd() })
        );
        await reporter.onResult(benchmarkHtmlFixture('first'));
        await reporter.onResult(benchmarkHtmlFixture('replacement'));
        const html = await readFile(outputFile, 'utf8');
        scope.assert.includes(html, 'replacement');
        scope.assert.includes(html, 'renderBenchmarkCharts');
        scope.assert.includes(html, 'metric-selection');
        scope.assert.equal(html.includes('<script src='), false);
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);
