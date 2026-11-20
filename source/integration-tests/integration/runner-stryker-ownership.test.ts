import { table, type TestNode, suite } from '@overkill-dev/test';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';

import { adapterUrl, engineUrl, configUrl } from './support/stryker-lifecycle-fixture.ts';
import { executeMutationScript } from './support/stryker-script.ts';
import { strykerCancellationScript, strykerDisconnectScript } from './support/stryker-ownership-scripts.ts';

const runModule = new URL(`../../packages/run/run.entry-point${extname(import.meta.url)}`, import.meta.url);
const runUrl = runModule.href;
const scenarios = [
    { title: 'cancellation preserves the session and disposal closes admission', script: strykerCancellationScript },
    { title: 'plugin worker death reaps its blocked invocation', script: strykerDisconnectScript }
];

export const testNode: TestNode = suite(
    'Stryker invocation ownership',
    [ table({
        title: 'runner stryker ownership scenarios',
        cases: [ 'in-process', 'supervised-process' ].flatMap(
            function processBoundary(processModel) {
                return scenarios.map(function ownershipScenario({ title, script }) {
                    return ({ caseDescription: `${processModel} ${title}`, processModel, title, script });
                });
            }
        ),
        caseTitle: (row) => row.caseDescription,
        async test(scope) {
            const { processModel, script } = scope.parameters;

            const cwd = await realpath(await mkdtemp(join(tmpdir(), 'overkill-stryker-ownership-')));
            scope.cleanup(async function removeProject() {
                await rm(cwd, { recursive: true, force: true });
            });
            const output = await executeMutationScript(script, [
                adapterUrl,
                engineUrl,
                configUrl,
                import.meta.resolve('@stryker-mutator/instrumenter'),
                processModel,
                runUrl
            ], cwd);
            scope.assert.equal(output, 'ownership passed\n');
            return scope.assert.collect();
        }
    }) ]
);
