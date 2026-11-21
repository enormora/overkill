import { extname } from 'node:path';
import { execFile } from 'node:child_process';
import { suite, test } from '@overkill-dev/test';

import { guardOwnershipTestNode, nativeGuardProbeUrl } from '../../../test-support/native-guard-probe.ts';

export const testNode = suite(guardOwnershipTestNode.title, [
    test('isolates native diagnostic probes from the runner', async function (scope) {
        const engineUrl = new URL(
            `../../../packages/engine/engine.entry-point${extname(import.meta.url)}`,
            import.meta.url
        );
        const script = `
            import assert from 'node:assert/strict';
            const { createRoot, createTestPlan, execute } = await import(${JSON.stringify(engineUrl.href)});
            const { guardOwnershipTestNode } = await import(${JSON.stringify(nativeGuardProbeUrl)});
            const plan = createTestPlan(createRoot({
                title: 'native guard probe', annotations: {}, controls: {}, children: [guardOwnershipTestNode]
            }));
            const result = await execute(plan);
            assert.equal(result.summary.passed, 9);
            assert.equal(result.summary.failed, 0);
            assert.deepEqual(result.runnerErrors, []);
        `;
        const output = await new Promise<string>(function runGuardProbe(resolve, reject) {
            execFile(
                process.execPath,
                [ '--input-type=module', '--eval', script ],
                { timeout: 5000 },
                function (error, stdout, stderr) {
                    if (error === null) {
                        resolve(stdout);
                    } else {
                        reject(new Error(`Native guard probe failed: ${stderr}`, { cause: error }));
                    }
                }
            );
        });
        scope.assert.equal(output, '');
        return scope.assert.collect();
    })
]);
