import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSuite, createTestCase, type TestScope } from '../../packages/engine/engine.entry-point.ts';
import { createLineReporter } from '../../packages/reporter-line/reporter-line.entry-point.ts';
import { runIfMain } from '../direct-launcher.test.ts';
import { strykerCampaignScript, strykerHitLimitScript } from './stryker-campaign-scripts.test.ts';
import {
    originalRoot,
    engineUrl,
    configUrl,
    adapterUrl,
    executeMutationScript,
    verifyMutationLifecycle
} from './stryker-lifecycle-fixture.test.ts';

const metadata = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;
const processModels = [ 'in-process', 'supervised-process' ] as const;
type CampaignMode = {
    readonly processModel: typeof processModels[number];
    readonly freshState: boolean;
    readonly looping: boolean;
};

async function campaignProject(scope: TestScope, prefix: string): Promise<string> {
    process.chdir(originalRoot);
    const cwd = await realpath(await mkdtemp(join(tmpdir(), prefix)));
    scope.cleanup(async function removeCampaignProject() {
        await rm(cwd, { recursive: true, force: true });
    });
    return cwd;
}

async function verifyCampaign(scope: TestScope, mode: CampaignMode): Promise<void> {
    const cwd = await campaignProject(scope, 'overkill-stryker-campaign-');
    const output = await executeMutationScript(strykerCampaignScript, [
        import.meta.resolve('@stryker-mutator/core'),
        adapterUrl,
        engineUrl,
        configUrl,
        mode.processModel,
        String(mode.freshState),
        mode.looping ? '100' : '1',
        mode.looping ? 'off' : 'perTest',
        String(mode.looping)
    ], cwd);
    scope.assert.equal(output, 'campaign passed\n');
}

export const testNode = createSuite({
    ...metadata,
    title: 'Stryker execution lifecycle',
    children: [
        createTestCase({
            ...metadata,
            title: 'tracks swallowed hit limits, cleanup coverage, and counter reset',
            async body(scope) {
                const cwd = await campaignProject(scope, 'overkill-stryker-hit-limit-');
                const output = await executeMutationScript(strykerHitLimitScript, [
                    import.meta.resolve('@stryker-mutator/instrumenter'),
                    adapterUrl,
                    engineUrl,
                    configUrl
                ], cwd);
                scope.assert.equal(output, 'hit limit passed\n');
                return scope.assert.collect();
            }
        }),
        ...processModels.flatMap(function executionModes(processModel) {
            return [ false, true ].flatMap(function stateModes(freshState) {
                return [
                    createTestCase({
                        ...metadata,
                        title: `${processModel} freshState ${
                            String(freshState)
                        } executes mutants and reports reload support`,
                        async body(scope) {
                            await verifyMutationLifecycle(scope, processModel, freshState);
                            return scope.assert.collect();
                        }
                    }),
                    ...[ false, true ].map(function campaignModes(looping) {
                        return createTestCase({
                            ...metadata,
                            title: `${processModel} freshState ${String(freshState)} ${
                                looping ? 'reaps synchronous loops' : 'replaces workers'
                            }`,
                            async body(scope) {
                                await verifyCampaign(scope, { processModel, freshState, looping });
                                return scope.assert.collect();
                            }
                        });
                    })
                ];
            });
        })
    ]
});

await runIfMain(import.meta, testNode, [ createLineReporter() ]);
