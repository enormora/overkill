import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { benchmarkHtmlFixture } from '../test-support/benchmark-html-fixture.ts';
import { readBenchmarkTimeline, benchmarkTimelineMediaType } from '../bench/timeline-report.ts';
import { runResultSchema } from '../run/run-result-schema.ts';
import type { RunResult } from '../engine/run-result.ts';
import { createBenchmarkHtmlReport } from './benchmark-html-model.ts';
import { renderBenchmarkHtml } from './benchmark-html-document.ts';

function timelineFixture(scope: TestScope): RunResult {
    const result = benchmarkHtmlFixture('timeline');
    const measured = result.perTest[0];
    const artifact = result.artifacts[0];
    scope.require.defined(measured);
    scope.require.defined(measured.benchmark);
    scope.require.defined(artifact);
    const timelineId = { ...artifact.id, subtype: 'attachment' as const, sequence: 1 };
    return {
        ...result,
        perTest: [ {
            ...measured,
            benchmark: {
                ...measured.benchmark,
                timeline: {
                    version: 1,
                    events: 1,
                    omitted: 2,
                    status: 'recorded',
                    reference: JSON.stringify(timelineId),
                    reason: null
                }
            }
        } ],
        artifacts: [ ...result.artifacts, {
            id: timelineId,
            source: 'native',
            payload: {
                kind: 'runtime-attachment',
                name: 'benchmark-timeline',
                mediaType: benchmarkTimelineMediaType,
                capturedAtMicroseconds: 0,
                capture: 'opt-in',
                producer: { kind: 'case' },
                content: {
                    kind: 'json',
                    byteLength: 0,
                    value: {
                        version: 1,
                        omitted: 2,
                        events: [ {
                            name: '<script>alert("marker")</script>',
                            source: 'authored',
                            phase: 'measured',
                            sample: 0,
                            clockDomain: 'runtime',
                            startMicroseconds: 1,
                            durationMicroseconds: null,
                            outcome: 'complete'
                        } ]
                    }
                }
            }
        } ]
    };
}

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
        const result = timelineFixture(scope);
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
        const result = timelineFixture(scope);
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
    })
]);
