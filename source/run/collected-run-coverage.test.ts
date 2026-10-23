import { execFile } from 'node:child_process';
import { runIfMain } from '#test-runner';
import { createSuite, createTestCase } from '../packages/engine/engine.entry-point.ts';

const metadata = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;

async function verifyCoveredInvocations(): Promise<string> {
    return new Promise(function launchCoverageProbe(resolve, reject) {
        execFile(process.execPath, [ 'source/integration-tests/run/fixtures/collected-coverage-probe.test.ts' ], {
            cwd: process.cwd(),
            timeout: 30_000
        }, function collectProbeOutput(error, stdout) {
            if (error instanceof Error) {
                reject(error);
            } else {
                resolve(stdout);
            }
        });
    });
}

export const testNode = createSuite({
    ...metadata,
    title: 'collected plan coverage',
    children: [ createTestCase({
        ...metadata,
        title: 'explicit ordinary coverage creates a fresh session and completed record for each invocation',
        async body(scope) {
            scope.assert.equal(await verifyCoveredInvocations(), 'collected coverage sessions passed\n');
            return scope.assert.collect();
        }
    }) ]
});

await runIfMain(import.meta, testNode);
