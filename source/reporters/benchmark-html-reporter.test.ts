import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
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
export const testNode = suite('benchmark HTML reporter', [
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
const { runIfMain } = await import('../test-support/run-if-main.ts');
await runIfMain(import.meta, testNode);
