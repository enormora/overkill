import { extname } from 'node:path';
import { execFile } from 'node:child_process';
import { type TestNode, suite, test } from '@overkill-dev/test';

import {
    nativeWriteOwnershipTestNode,
    nativeWriteOwnershipProbeUrl
} from '../../../test-support/native-write-ownership-probe.ts';

export const testNode: TestNode = suite(nativeWriteOwnershipTestNode.title, [
    test('isolates native write probes from runner writes', async function (scope) {
        const engineUrl = new URL(
            `../../../packages/engine/engine.entry-point${extname(import.meta.url)}`,
            import.meta.url
        );
        const script = `
            import assert from 'node:assert/strict';
            const { createRoot, createTestPlan, execute } = await import(${JSON.stringify(engineUrl.href)});
            const { nativeWriteOwnershipTestNode } = await import(${JSON.stringify(nativeWriteOwnershipProbeUrl)});
            const plan = createTestPlan(createRoot({
                title: 'native write probe', annotations: {}, controls: {}, children: [nativeWriteOwnershipTestNode]
            }));
            const result = await execute(plan);
            assert.equal(result.summary.passed, 8);
            assert.equal(result.summary.failed, 0);
            assert.deepEqual(result.runnerErrors, []);
        `;
        const output = await new Promise<string>(function runWriteProbe(resolve, reject) {
            execFile(
                process.execPath,
                [ '--input-type=module', '--eval', script ],
                { timeout: 5000 },
                function (error, stdout, stderr) {
                    if (error === null) {
                        resolve(stdout);
                    } else {
                        reject(new Error(`Native write probe failed: ${stderr}`, { cause: error }));
                    }
                }
            );
        });
        scope.assert.equal(output, '');
        return scope.assert.collect();
    })
]);
