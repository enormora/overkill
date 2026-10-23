import { readFile, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { createSuite, createTestCase, type TestScope } from '@overkill-dev/engine';
import type { createBenchmarkHtmlReporter } from '@overkill-dev/reporter-benchmark-html';
import { createLineReporter } from '@overkill-dev/reporter-line';
import { runIfMain } from '#test-runner';
import { benchmarkHtmlTimelineFixture } from '../../test-support/benchmark-html-fixture.ts';

async function outputPath(scope: TestScope): Promise<string> {
    const directory = await mkdtemp('target/installed-benchmark-html-');
    scope.cleanup(async function removeReport() {
        await rm(directory, { recursive: true, force: true });
    });
    return path.resolve(directory, 'report.html');
}
async function assertRenderedReport(
    scope: TestScope,
    factory: typeof createBenchmarkHtmlReporter,
    title: string
): Promise<void> {
    const outputFile = await outputPath(scope);
    const reporter = factory({ outputFile })({
        relativizeLocationPath(location) {
            return location.file;
        }
    });
    await reporter.onResult(benchmarkHtmlTimelineFixture(title, 'packaged marker'));
    const html = await readFile(outputFile, 'utf8');
    scope.assert.includes(html, title);
    scope.assert.includes(html, 'renderBenchmarkCharts');
    scope.assert.includes(html, '<td>authored</td><td>packaged marker</td>');
    scope.assert.equal(html.includes('<script src='), false);
}
export const testNode = createSuite({
    title: 'installed benchmark HTML reporter',
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    children: [
        createTestCase({
            title: 'leaf import renders with packaged browser assets',
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' } ],
            async body(scope) {
                const leaf = await import('@overkill-dev/reporter-benchmark-html');
                await assertRenderedReport(scope, leaf.createBenchmarkHtmlReporter, 'installed leaf');
                return scope.assert.collect();
            }
        }),
        createTestCase({
            title: 'standard subpath renders with bundled browser assets',
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' } ],
            async body(scope) {
                const standard = await import('@overkill-dev/test/reporters');
                await assertRenderedReport(scope, standard.createBenchmarkHtmlReporter, 'standard distribution');
                return scope.assert.collect();
            }
        })
    ]
});
await runIfMain(import.meta, testNode, { reporters: [ createLineReporter() ] });
