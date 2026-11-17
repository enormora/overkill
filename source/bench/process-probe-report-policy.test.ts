import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { processProbeReportStorage, processProbeReport } from '../test-support/process-probe-report.ts';

export const testNode = suite('bounded process probe reports', [
    test('combines partial reads and releases file and directory ownership', async function (scope: TestScope) {
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
    ...([ 'invalid-json', 'invalid-report', 'oversized', 'read-error' ] as const).map(function (scenario) {
        return test(`rejects ${scenario} reports and closes the file`, async function (scope: TestScope) {
            const fixture = processProbeReportStorage(scenario);
            const storage = await fixture.prepare();
            if (scenario === 'read-error') {
                await scope.assert.rejects(storage.read, { exact: fixture.failure });
            } else {
                await scope.assert.rejects(
                    storage.read,
                    scenario === 'oversized'
                        ? { message: 'Node probe exceeded the final report limit.' }
                        : { type: Error }
                );
            }
            scope.assert.deepEqual(Array.from(fixture.calls), [ 'directory', 'open:/reports/report.json', 'close' ]);
            await storage.dispose();
            return scope.assert.collect();
        });
    })
]);
await runIfMain(import.meta, testNode);
