import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runIfMain } from '#test-runner';
import { suite, test } from '../../packages/test/test.entry-point.ts';
import { createLineReporter } from '../../packages/reporter-line/reporter-line.entry-point.ts';
import { adapterUrl, engineUrl, configUrl, executeMutationScript } from './stryker-lifecycle-fixture.test.ts';
import { strykerDryRunScript } from './stryker-dry-run-scripts.test.ts';

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

export const testNode = suite(
    'Stryker structured dry runs',
    modes.map(function scenario(mode) {
        return test(
            `${mode.processModel} freshState ${String(mode.freshState)} ${mode.scenario} ${
                mode.campaign === 'none'
                    ? 'plugin result'
                    : 'aborts campaign without a score'
            }`,
            async function (scope) {
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
        );
    })
);

await runIfMain(import.meta, testNode, { reporters: [ createLineReporter() ] });
