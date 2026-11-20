import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { table, type TestNode, suite } from '@overkill-dev/test';

import { adapterUrl, engineUrl, configUrl } from './support/stryker-lifecycle-fixture.ts';
import { executeMutationScript } from './support/stryker-script.ts';
import { strykerTimeoutScript } from './support/stryker-timeout-scripts.ts';

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

export const testNode: TestNode = suite(
    'Stryker timeout enforcement',
    [ table({
        title: 'classifies timeouts across execution boundaries',
        cases: [ 'in-process', 'supervised-process' ].flatMap(
            function executionBoundary(processModel) {
                const cases = processModel === 'supervised-process'
                    ? [ ...scenarios, 'hard' ]
                    : [ ...scenarios, 'soft-reused' ];
                return cases.map(function timeoutScenario(scenario) {
                    return { processModel, scenario };
                });
            }
        ),
        caseTitle({ processModel, scenario }) {
            return [ processModel, scenario ].map(String).join(', ');
        },
        async test(scope) {
            const { processModel, scenario } = scope.parameters;

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
        }
    }) ]
);
