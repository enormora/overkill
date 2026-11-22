import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { suite } from '@overkill-dev/test';
import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import type * as BenchmarkHtmlPackage from '../../packages/reporter-benchmark-html/reporter-benchmark-html.entry-point.ts';
import { defaultFailureArtifactPolicy } from '../../engine/failure-artifact-policy.ts';
import { benchmarkHtmlTimelineFixture } from '../../test-support/benchmark-html-fixture.ts';
import { packageConsumer } from './support/package-consumer.ts';
import { resolvePackagedExport } from './support/packaged-module.ts';

const packagedReport = defineCompositeAssertion({
    name: 'packaged benchmark report',
    assert(check, html: string, title: string) {
        return check.group([
            check.includes(html, title),
            check.includes(html, 'renderBenchmarkCharts'),
            check.includes(html, '<td>authored</td><td>packaged marker</td>'),
            check.false(html.includes('<script src='))
        ]);
    }
});

const consumerFacade = packageConsumer('Installed benchmark HTML reporter', function consumerFixture(directory) {
    async function renderReport(
        factory: typeof BenchmarkHtmlPackage.createBenchmarkHtmlReporter,
        title: string
    ): Promise<string> {
        const outputFile = path.join(directory, 'report.html');
        const reporter = factory({ outputFile })({
            failureArtifacts: defaultFailureArtifactPolicy,
            relativizeLocationPath(location) {
                return location.file;
            }
        });
        await reporter.onResult({
            context: { id: null, startedAt: null, facts: null },
            result: benchmarkHtmlTimelineFixture(title, 'packaged marker')
        });
        return await readFile(outputFile, 'utf8');
    }

    return { renderReport };
});
const { table } = consumerFacade;

export const testNode = suite('Installed benchmark HTML reporter', [
    table({
        title: 'renders with packaged browser assets',
        cases: [
            { title: 'leaf import', specifier: '@overkill-dev/reporter-benchmark-html' },
            { title: 'standard subpath', specifier: '@overkill-dev/test/reporters' }
        ],
        caseTitle(entry) {
            return entry.title;
        },
        async test(scope) {
            const { title, specifier } = scope.parameters;
            const { renderReport } = scope.resources.consumer;
            const { createBenchmarkHtmlReporter } = await import(
                await resolvePackagedExport(specifier)
            ) as typeof BenchmarkHtmlPackage;
            scope.assert(packagedReport, await renderReport(createBenchmarkHtmlReporter, title), title);
            return scope.assert.collect();
        }
    })
]);
