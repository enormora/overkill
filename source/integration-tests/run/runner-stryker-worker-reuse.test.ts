import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, suite as authoredSuite } from '@overkill-dev/test';

import { adapterUrl, engineUrl, configUrl } from './stryker-lifecycle-fixture.test.ts';
import { executeMutationScript } from './stryker-script.test.ts';
import { strykerWorkerReuseScript, strykerHungCleanupScript } from './stryker-worker-reuse-scripts.test.ts';

export const testNode = authoredSuite(
    'Stryker surviving worker reuse',
    [
        {
            title: 'reuses the worker after unsafe invocations without blaming the next case',
            script: strykerWorkerReuseScript,
            expected: 'worker reuse passed\n',
            arguments: [ adapterUrl, engineUrl, configUrl, import.meta.resolve('@stryker-mutator/instrumenter') ]
        },
        {
            title: 'leaves a hung cleanup in the plugin worker to Stryker deadline recovery',
            script: strykerHungCleanupScript,
            expected: 'hung cleanup passed\n',
            arguments: [ import.meta.resolve('@stryker-mutator/core'), adapterUrl, engineUrl, configUrl ]
        }
    ]
        .map(function workerReuseScenario(scenario) {
            return test(scenario.title, async function (scope) {
                const cwd = await realpath(await mkdtemp(join(tmpdir(), 'overkill-stryker-worker-reuse-')));
                scope.cleanup(async function removeProject() {
                    await rm(cwd, { recursive: true, force: true });
                });
                const output = await executeMutationScript(scenario.script, scenario.arguments, cwd);
                scope.assert.equal(output, scenario.expected);
                return scope.assert.collect();
            });
        })
);
