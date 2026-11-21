import { execFile } from 'node:child_process';
import { suite, test } from '@overkill-dev/test';

async function verifyCoveredInvocations(): Promise<string> {
    return new Promise(function launchCoverageProbe(resolve, reject) {
        execFile(
            process.execPath,
            [ '--allow-inspector', 'source/integration-tests/runtime/fixtures/collected-coverage-probe.test.ts' ],
            {
                cwd: process.cwd(),
                timeout: 30_000
            },
            function collectProbeOutput(error, stdout) {
                if (error instanceof Error) {
                    reject(error);
                } else {
                    resolve(stdout);
                }
            }
        );
    });
}

export const testNode = suite('collected plan coverage', [
    test(
        'explicit ordinary coverage creates a fresh session and completed record for each invocation',
        async function (scope) {
            scope
                .assert
                .equal(await verifyCoveredInvocations(), 'collected coverage sessions passed\n');
            return scope.assert.collect();
        }
    )
]);
