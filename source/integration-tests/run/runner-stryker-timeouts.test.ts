import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { suite, test } from '../../packages/test/test.entry-point.ts';
import { createLineReporter } from '../../packages/reporter-line/reporter-line.entry-point.ts';
import { runIfMain } from '../direct-launcher.test.ts';
import { adapterUrl, engineUrl, configUrl, executeMutationScript } from './stryker-lifecycle-fixture.test.ts';
import { strykerTimeoutScript } from './stryker-timeout-scripts.test.ts';

const scenarios = [
    'startup',
    'pending-startup',
    'collection',
    'body',
    'cleanup',
    'continued',
    'dispose',
    'hit-limit',
    'hit-limit-error',
    'static-hit-limit',
    'config-hit-limit',
    'config-hit-limit-error',
    'soft',
    'case-soft'
];

export const testNode = suite(
    'Stryker timeout enforcement',
    [ 'in-process', 'supervised-process' ].flatMap(
        function executionBoundary(processModel) {
            const cases = processModel === 'supervised-process'
                ? [ ...scenarios, 'hard' ]
                : [ ...scenarios, 'soft-reused' ];
            return cases.map(function timeoutScenario(scenario) {
                return test(`${processModel} ${scenario}`, async function (scope) {
                    const cwd = await realpath(await mkdtemp(join(tmpdir(), 'overkill-stryker-timeout-')));
                    scope.cleanup(async function removeProject() {
                        await rm(cwd, { recursive: true, force: true });
                    });
                    const output = await executeMutationScript(strykerTimeoutScript, [
                        adapterUrl,
                        engineUrl,
                        configUrl,
                        import.meta.resolve('@stryker-mutator/instrumenter'),
                        processModel,
                        scenario
                    ], cwd);
                    scope.assert.equal(output, 'timeout passed\n');
                    return scope.assert.collect();
                });
            });
        }
    )
);

await runIfMain(import.meta, testNode, [ createLineReporter() ]);
