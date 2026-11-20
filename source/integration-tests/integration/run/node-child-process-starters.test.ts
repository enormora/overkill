import { type TestNode, suite, test } from '@overkill-dev/test';

import { executeMutationScript as executeNodeScript } from '../support/stryker-script.ts';

const startersUrl = new URL('../../../run/node-child-process-starters.ts', import.meta.url);

export const testNode: TestNode = suite('runner child process shutdown', [
    test(
        'closing transport releases the child process handle before native close delivery',
        async function (scope) {
            const script = `
            import assert from 'node:assert/strict';
            const {startSupervisedChild} = await import(${JSON.stringify(startersUrl.href)});
            const child = await startSupervisedChild({
                capabilityRestrictions: {mode:'disabled'},
                coverage: null,
                cwd: process.cwd(),
                environmentVariables: process.env,
                testFamily: 'integration'
            });
            try {
                assert.ok(process.getActiveResourcesInfo().includes('ProcessWrap'));
                child.closeTransport();
                assert.equal(process.getActiveResourcesInfo().includes('ProcessWrap'),false);
                console.log('child process handle released');
            } finally {
                child.kill('SIGKILL');
            }
        `;
            const output = await executeNodeScript(script, [], process.cwd());
            scope.assert.equal(output, 'child process handle released\n');
            return scope.assert.collect();
        }
    )
]);
