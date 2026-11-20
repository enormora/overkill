import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { table, type TestNode, suite } from '@overkill-dev/test';

import { adapterUrl, engineUrl, configUrl } from './support/stryker-lifecycle-fixture.ts';
import { executeMutationScript } from './support/stryker-script.ts';
import { strykerDryRunScript } from './support/stryker-dry-run-scripts.ts';

const modes = ([ 'in-process', 'supervised-process' ] as const).flatMap(function executionModes(processModel) {
    return [ false, true ]
        .flatMap(function stateModes(freshState) {
            return [ 'mixed', 'cleanup', 'timeout' ].map(function scenarios(scenario) {
                return { processModel, freshState, scenario, campaign: 'none' };
            });
        })
        .concat([ 'cleanup', 'timeout' ].map(function failedCampaigns(scenario) {
            return {
                processModel,
                freshState: false,
                scenario,
                campaign: import.meta.resolve('@stryker-mutator/core')
            };
        }));
});

export const testNode: TestNode = suite(
    'Stryker structured dry runs',
    [ table({
        title: 'returns native dry-run evidence across execution boundaries',
        cases: modes,
        caseTitle(mode) {
            return `${mode.processModel} freshState ${String(mode.freshState)} ${mode.scenario} ${
                mode.campaign === 'none'
                    ? 'plugin result'
                    : 'aborts campaign without a score'
            }`;
        },
        async test(scope) {
            const mode = scope.parameters;

            const cwd = await realpath(await mkdtemp(join(tmpdir(), 'overkill-stryker-dry-run-')));
            scope.cleanup(async function removeProject() {
                await rm(cwd, { recursive: true, force: true });
            });
            const output = await executeMutationScript(strykerDryRunScript, [
                adapterUrl,
                engineUrl,
                configUrl,
                mode.processModel,
                String(mode.freshState),
                mode.scenario,
                mode.campaign,
                import.meta.resolve('@stryker-mutator/api/test-runner')
            ], cwd);
            scope.assert.equal(output, 'dry run passed\n');
            return scope.assert.collect();
        }
    }) ]
);
