import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { benchmarkHtmlFixture, benchmarkHtmlTimelineFixture } from '../test-support/benchmark-html-fixture.ts';
import { readBenchmarkTimeline } from '../bench/timeline-report.ts';
import { runResultSchema } from '../run/run-result-schema.ts';
import { createBenchmarkHtmlReport } from './benchmark-html-model.ts';
import { renderBenchmarkHtml } from './benchmark-html-document.ts';

export const testNode = suite('benchmark HTML timeline evidence and deltas', [
    test('decodes historical results with unavailable timeline evidence', function (scope: TestScope) {
        const result = benchmarkHtmlFixture('historical');
        const measured = result.perTest[0];
        scope.require.defined(measured);
        const decoded = runResultSchema.parse({
            ...result,
            perTest: [ { ...measured, benchmark: { ...measured.benchmark, timeline: undefined } } ]
        });
        scope.assert.equal(decoded.perTest[0]?.benchmark?.timeline, null);
        scope.assert.equal(readBenchmarkTimeline(decoded, measured), null);
        return scope.assert.collect();
    }),
    test('reads saved timelines and escapes authored names in offline HTML', function (scope: TestScope) {
        const result = benchmarkHtmlTimelineFixture('timeline', '<script>alert("marker")</script>');
        const measured = result.perTest[0];
        scope.require.defined(measured);
        scope.assert.equal(
            readBenchmarkTimeline(result, measured)?.events[0]?.name,
            '<script>alert("marker")</script>'
        );
        const html = renderBenchmarkHtml(createBenchmarkHtmlReport(result), '');
        scope.assert.includes(html, '&lt;script&gt;alert');
        scope.assert.false(html.includes('<script>alert("marker")</script>'));
        scope.assert.includes(html, 'omitted');
        return scope.assert.collect();
    }),
    test('rejects a timeline reference belonging to another workload', function (scope: TestScope) {
        const result = benchmarkHtmlTimelineFixture('timeline', '<script>alert("marker")</script>');
        const measured = result.perTest[0];
        scope.require.defined(measured);
        scope.assert.throws(function crossWorkload() {
            readBenchmarkTimeline(result, {
                ...measured,
                workId: {
                    ...measured.workId,
                    workload: { name: 'other', params: {} }
                }
            });
        }, { message: 'Timeline artifact belongs to another workload, runtime, case, or attempt.' });
        return scope.assert.collect();
    }),
    test('leaves missing retained timeline artifacts unavailable', function (scope: TestScope) {
        const result = benchmarkHtmlTimelineFixture('missing evidence', 'marker');
        const measured = result.perTest[0];
        scope.require.defined(measured);
        scope.assert.equal(readBenchmarkTimeline({ ...result, artifacts: [] }, measured), null);
        return scope.assert.collect();
    }),
    test('rejects retained evidence from a different attempt', function (scope: TestScope) {
        const result = benchmarkHtmlTimelineFixture('different attempt', 'marker');
        const measured = result.perTest[0];
        scope.require.defined(measured);
        scope.assert.throws(function crossAttempt() {
            readBenchmarkTimeline(result, {
                ...measured,
                attempts: [ { ...measured.attempts[0], attempt: { index: 1 } } ]
            });
        }, { message: 'Timeline artifact belongs to another workload, runtime, case, or attempt.' });
        return scope.assert.collect();
    })
]);
