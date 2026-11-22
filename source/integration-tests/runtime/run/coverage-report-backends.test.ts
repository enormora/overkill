import { type TestScope, suite, test } from '@overkill-dev/test';

import { coverageReportBackend } from '../../../test-support/coverage-report-backend.ts';
import { collectCoverageReports, type CoverageReportRequest } from '../../../run/coverage-reporting.ts';

const request: CoverageReportRequest = {
    coverageDirectory: '/project/coverage',
    projectRoot: '/project',
    rawDataDirectory: '/project/raw',
    outputs: [ 'html', 'json', 'lcov', 'text', 'v8' ],
    sourceScope: { mode: 'loaded', exclude: [], excludedFiles: new Set() }
};
const metric = { covered: 1, total: 2 };
const backendMetric = { ...metric, pct: 50, status: 'medium' as const };
const summary = {
    branches: backendMetric,
    functions: backendMetric,
    lines: backendMetric,
    statements: backendMetric,
    bytes: backendMetric
};
export const testNode = suite('coverage report backend policy', [
    test('maps requested reports to paths and preserves executable summary counts', async function (scope) {
        const fixture = coverageReportBackend(true, { summary }, true);
        const result = await collectCoverageReports(request, fixture.runtime);
        scope.assert.deepEqual(result.reports, [
            { format: 'html', path: '/project/coverage/html/index.html' },
            { format: 'json', path: '/project/coverage/coverage-final.json' },
            { format: 'lcov', path: '/project/coverage/lcov.info' },
            { format: 'text', path: '/project/coverage/coverage.txt' },
            { format: 'v8', path: '/project/coverage/v8/index.html' }
        ]);
        scope.assert.deepEqual(result.summary, {
            branches: { ...metric },
            functions: { ...metric },
            lines: { ...metric }
        });
        scope.assert.deepEqual(fixture.calls.slice(1), [ { directory: '/project/raw' }, 'generate' ]);
        return scope.assert.collect();
    }),
    test('initializes a filtered empty cache from native V8 entries', async function (scope) {
        const fixture = coverageReportBackend(false, { summary }, true);
        await collectCoverageReports(request, fixture.runtime);
        scope.assert.deepEqual(fixture.calls.slice(1), [ { directory: '/project/raw' }, {
            batch: [ { url: 'file:///project/source/value.js' } ]
        }, 'generate' ]);
        return scope.assert.collect();
    }),
    test('rejects a run without native coverage data', async function (scope: TestScope) {
        const fixture = coverageReportBackend(false, { summary }, false);
        let failure: unknown = null;
        try {
            await collectCoverageReports(request, fixture.runtime);
        } catch (error: unknown) {
            failure = error;
        }
        scope.require.instanceOf(failure, Error);
        scope.assert.equal(failure.message, 'Coverage collection produced no native V8 data.');
        scope.assert.equal(fixture.calls.includes('generate'), false);
        return scope.assert.collect();
    }),
    test('rejects a missing backend result', async function (scope: TestScope) {
        const fixture = coverageReportBackend(true, undefined, true);
        let failure: unknown = null;
        try {
            await collectCoverageReports(request, fixture.runtime);
        } catch (error: unknown) {
            failure = error;
        }
        scope.require.instanceOf(failure, Error);
        scope.assert.equal(failure.message, 'Coverage backend produced no result.');
        return scope.assert.collect();
    }),
    test('rejects coverage with no executable source selection', async function (scope: TestScope) {
        const empty = {
            ...summary,
            branches: { ...summary.branches, total: 0 },
            functions: { ...summary.functions, total: 0 },
            lines: { ...summary.lines, total: 0 }
        };
        const fixture = coverageReportBackend(true, { summary: empty }, true);
        let failure: unknown = null;
        try {
            await collectCoverageReports(request, fixture.runtime);
        } catch (error: unknown) {
            failure = error;
        }
        scope.require.instanceOf(failure, Error);
        scope.assert.equal(failure.message, 'Coverage source selection contains no executable sources.');
        return scope.assert.collect();
    }),
    test('can collect executable summaries without writing report files', async function (scope) {
        const fixture = coverageReportBackend(true, { summary }, true);
        const result = await collectCoverageReports({
            ...request,
            outputs: [],
            sourceScope: { mode: 'all', include: [ 'source/**/*.js' ], exclude: [], excludedFiles: new Set() }
        }, fixture.runtime);
        scope.assert.deepEqual(result.reports, []);
        scope.assert.deepEqual(result.summary, {
            branches: { ...metric },
            functions: { ...metric },
            lines: { ...metric }
        });
        scope.assert.deepEqual<unknown, unknown>(Reflect.get(fixture.calls[0] ?? {}, 'reports'), [ [ 'none' ] ]);
        return scope.assert.collect();
    })
]);
