import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { runIfMain } from '#test-runner';
import { suite, test } from '../../packages/test/test.entry-point.ts';
import { createLineReporter } from '../../packages/reporter-line/reporter-line.entry-point.ts';
import { adapterUrl, engineUrl, configUrl } from './stryker-lifecycle-fixture.test.ts';
import { executeMutationScript } from './stryker-script.test.ts';
import { strykerCancellationScript, strykerDisconnectScript } from './stryker-ownership-scripts.test.ts';

const runModule = new URL(`../../packages/run/run.entry-point${extname(import.meta.url)}`, import.meta.url);
const runUrl = runModule.href;
const scenarios = [
    { title: 'cancellation preserves the session and disposal closes admission', script: strykerCancellationScript },
    { title: 'plugin worker death reaps its blocked invocation', script: strykerDisconnectScript }
];

export const testNode = suite(
    'Stryker invocation ownership',
    [ 'in-process', 'supervised-process' ].flatMap(
        function processBoundary(processModel) {
            return scenarios.map(function ownershipScenario({ title, script }) {
                return test(`${processModel} ${title}`, async function (scope) {
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
                });
            });
        }
    )
);

await runIfMain(import.meta, testNode, { reporters: [ createLineReporter() ] });
