import { table, type TestNode, suite } from '@overkill-dev/test';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { adapterUrl, engineUrl, configUrl } from './support/stryker-lifecycle-fixture.ts';
import { executeMutationScript } from './support/stryker-script.ts';
import { strykerWorkerReuseScript, strykerHungCleanupScript } from './support/stryker-worker-reuse-scripts.ts';

export const testNode: TestNode = suite(
    'Stryker surviving worker reuse',
    [ table({
        title: 'runner stryker worker reuse scenarios',
        cases: [
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
        ],
        caseTitle(scenario) {
            return scenario.title;
        },
        async test(scope) {
            const scenario = scope.parameters;

            const cwd = await realpath(await mkdtemp(join(tmpdir(), 'overkill-stryker-worker-reuse-')));
            scope.cleanup(async function removeProject() {
                await rm(cwd, { recursive: true, force: true });
            });
            const output = await executeMutationScript(scenario.script, scenario.arguments, cwd);
            scope.assert.equal(output, scenario.expected);
            return scope.assert.collect();
        }
    }) ]
);
