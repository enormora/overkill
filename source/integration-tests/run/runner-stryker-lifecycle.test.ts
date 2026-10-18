import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSuite, createTestCase, type TestScope } from '../../packages/engine/engine.entry-point.ts';
import { createLineReporter } from '../../packages/reporter-line/reporter-line.entry-point.ts';
import { runIfMain } from '../direct-launcher.test.ts';
import { strykerCampaignScript, strykerHitLimitScript } from './stryker-campaign-scripts.test.ts';
import { strykerCoverageScript } from './stryker-coverage-scripts.test.ts';
import { strykerIdentityScript } from './stryker-identity-scripts.test.ts';
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
    readonly coverageAnalysis: 'all' | 'off' | 'perTest';
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
        mode.coverageAnalysis,
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
                        } preserves mutation identities across sandboxes`,
                        async body(scope) {
                            const outputs: string[] = [];
                            for (const prefix of [ 'overkill-stryker-identity-', 'overkill-stryker-replacement-' ]) {
                                const cwd = await campaignProject(scope, prefix);
                                outputs.push(
                                    await executeMutationScript(strykerIdentityScript, [
                                        import.meta.resolve('@stryker-mutator/instrumenter'),
                                        adapterUrl,
                                        engineUrl,
                                        configUrl,
                                        processModel,
                                        String(freshState)
                                    ], cwd)
                                );
                            }
                            scope.assert.equal(outputs[0], outputs[1]);
                            return scope.assert.collect();
                        }
                    }),
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
                    ...([ 'perTest', 'all', 'off' ] as const).map(function coverageModes(coverageAnalysis) {
                        return createTestCase({
                            ...metadata,
                            title: `${processModel} freshState ${String(freshState)} ${coverageAnalysis} coverage`,
                            async body(scope) {
                                const cwd = await campaignProject(scope, 'overkill-stryker-coverage-');
                                const output = await executeMutationScript(strykerCoverageScript, [
                                    import.meta.resolve('@stryker-mutator/instrumenter'),
                                    adapterUrl,
                                    engineUrl,
                                    configUrl,
                                    processModel,
                                    String(freshState),
                                    coverageAnalysis
                                ], cwd);
                                scope.assert.equal(output, 'coverage passed\n');
                                await verifyCampaign(scope, {
                                    processModel,
                                    freshState,
                                    looping: false,
                                    coverageAnalysis
                                });
                                return scope.assert.collect();
                            }
                        });
                    }),
                    createTestCase({
                        ...metadata,
                        title: `${processModel} freshState ${String(freshState)} reaps synchronous loops`,
                        async body(scope) {
                            await verifyCampaign(scope, {
                                processModel,
                                freshState,
                                looping: true,
                                coverageAnalysis: 'off'
                            });
                            return scope.assert.collect();
                        }
                    })
                ];
            });
        })
    ]
});

await runIfMain(import.meta, testNode, [ createLineReporter() ]);
