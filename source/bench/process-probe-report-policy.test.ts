import { table, suite, test } from '@overkill-dev/test';

import { processProbeReportStorage, processProbeReport } from '../test-support/process-probe-report.ts';

const invalidReportMatchers = {
    'invalid-json': { type: SyntaxError },
    'invalid-report': { message: /"path":\s*\[\s*"version"\s*\]/u },
    oversized: { message: 'Node probe exceeded the final report limit.' }
} as const;

export const testNode = suite('bounded process probe reports', [
    test('combines partial reads and releases file and directory ownership', async function (scope) {
        const fixture = processProbeReportStorage('pass');
        const storage = await fixture.prepare();
        scope.assert.equal(storage.path, '/reports/report.json');
        scope.assert.deepEqual(await storage.read(), processProbeReport);
        await storage.dispose();
        scope.assert.deepEqual(Array.from(fixture.calls), [
            'directory',
            'open:/reports/report.json',
            'close',
            'remove:/reports'
        ]);
        return scope.assert.collect();
    }),
    table({
        title: 'rejects invalid probe reports and closes the file',
        cases: [ 'invalid-json', 'invalid-report', 'oversized', 'read-error' ] as const,
        caseTitle(scenario) {
            return scenario;
        },
        async test(scope) {
            const scenario = scope.parameters;

            const fixture = processProbeReportStorage(scenario);
            const storage = await fixture.prepare();
            if (scenario === 'read-error') {
                await scope.assert.rejects(storage.read, { exact: fixture.failure });
            } else {
                await scope.assert.rejects(storage.read, invalidReportMatchers[scenario]);
            }
            scope.assert.deepEqual(Array.from(fixture.calls), [ 'directory', 'open:/reports/report.json', 'close' ]);
            await storage.dispose();
            return scope.assert.collect();
        }
    })
]);
