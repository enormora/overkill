import { runIfMain } from '#test-runner';
import { suite, test } from '../packages/test/test.entry-point.ts';
import { executeMutationScript as executeNodeScript } from '../integration-tests/run/stryker-script.test.ts';

const startersUrl = new URL('./node-child-process-starters.ts', import.meta.url);

export const testNode = suite('runner child process shutdown', [
    test('closing transport releases the child process handle before native close delivery', async function (scope) {
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
    })
]);

await runIfMain(import.meta, testNode);
