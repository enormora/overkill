import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { type TestNode, type TestScope, suite, test } from '@overkill-dev/test';

import { benchmarkHtmlFixture } from '../../../test-support/benchmark-html-fixture.ts';
import { createReportingContext } from '../../../engine/reporting-context.ts';
import { createBenchmarkHtmlReporter } from '../../../reporters/benchmark-html-reporter.ts';

async function outputDirectory(scope: TestScope): Promise<string> {
    const directory = await mkdtemp('target/benchmark-html-test-');
    scope.cleanup(async function removeOutput() {
        await rm(directory, { recursive: true, force: true });
    });
    return directory;
}
export const testNode: TestNode = suite('benchmark HTML output integration', [
    test('writes a self-contained report and replaces it atomically', async function (scope) {
        const outputFile = join(await outputDirectory(scope), 'nested/report.html');
        const reporter = createBenchmarkHtmlReporter({ outputFile })(
            createReportingContext({ projectRoot: process.cwd() })
        );
        await reporter.onResult({
            result: benchmarkHtmlFixture('first'),
            context: { id: null, startedAt: null, facts: null }
        });
        await reporter.onResult({
            result: benchmarkHtmlFixture('replacement'),
            context: { id: null, startedAt: null, facts: null }
        });
        const html = await readFile(outputFile, 'utf8');
        scope.assert.includes(html, 'replacement');
        scope.assert.includes(html, 'renderBenchmarkCharts');
        scope.assert.includes(html, 'metric-selection');
        scope.assert.equal(html.includes('<script src='), false);
        return scope.assert.collect();
    })
]);
