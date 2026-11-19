import { readFile, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { suite, test, type TestScope } from '#tests';
import type { createBenchmarkHtmlReporter } from '@overkill-dev/test/reporters';
import type * as BenchmarkHtmlPackage from '../../packages/reporter-benchmark-html/reporter-benchmark-html.entry-point.ts';
import { defaultFailureArtifactPolicy } from '../../engine/failure-artifact-policy.ts';
import { benchmarkHtmlTimelineFixture } from '../../test-support/benchmark-html-fixture.ts';
import { resolvePackagedExport } from './packaged-module.test.ts';

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
        failureArtifacts: defaultFailureArtifactPolicy,
        relativizeLocationPath(location) {
            return location.file;
        }
    });
    await reporter.onResult({
        context: {
            id: null,
            startedAt: null,
            facts: null
        },
        result: benchmarkHtmlTimelineFixture(
            title,
            'packaged marker'
        )
    });
    const html = await readFile(outputFile, 'utf8');
    scope.assert.includes(html, title);
    scope.assert.includes(html, 'renderBenchmarkCharts');
    scope.assert.includes(html, '<td>authored</td><td>packaged marker</td>');
    scope.assert.equal(html.includes('<script src='), false);
}
export const testNode = suite('installed benchmark HTML reporter', [
    test('leaf import renders with packaged browser assets', async function (scope) {
        const leaf = await import(
            await resolvePackagedExport('@overkill-dev/reporter-benchmark-html')
        ) as typeof BenchmarkHtmlPackage;
        await assertRenderedReport(scope, leaf.createBenchmarkHtmlReporter, 'installed leaf');
        return scope.assert.collect();
    }),
    test('standard subpath renders with bundled browser assets', async function (scope) {
        const standard = await import('@overkill-dev/test/reporters');
        await assertRenderedReport(scope, standard.createBenchmarkHtmlReporter, 'standard distribution');
        return scope.assert.collect();
    })
]);
