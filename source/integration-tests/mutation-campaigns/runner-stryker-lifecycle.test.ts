import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { table, suite, test, type TestScope } from '@overkill-dev/test';

import { strykerCampaignScript, strykerHitLimitScript } from '../runtime/support/stryker-campaign-scripts.ts';
import { strykerCoverageScript } from '../runtime/support/stryker-coverage-scripts.ts';
import { strykerIdentityScript } from '../runtime/support/stryker-identity-scripts.ts';
import {
    createMutationProject,
    engineUrl,
    configUrl,
    adapterUrl,
    verifyMutationLifecycle
} from '../runtime/support/stryker-lifecycle-fixture.ts';
import { executeMutationScript } from '../runtime/support/stryker-script.ts';

const processModels = [ 'in-process', 'supervised-process' ] as const;
type CampaignMode = {
    readonly processModel: typeof processModels[number];
    readonly freshState: boolean;
    readonly looping: boolean;
    readonly coverageAnalysis: 'all' | 'off' | 'perTest';
};

const verifyCampaign = defineCompositeAssertion({
    name: 'verify campaign',
    async assert(check, registerCleanup: TestScope['cleanup'], mode: CampaignMode) {
        const cwd = await createMutationProject(registerCleanup, 'overkill-stryker-campaign-');
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
        return check.equal(output, 'campaign passed\n');
    }
});

export const testNode = suite('Stryker execution lifecycle', [
    test('tracks swallowed hit limits, cleanup coverage, and counter reset', async function (scope) {
        const cwd = await createMutationProject(scope.cleanup, 'overkill-stryker-hit-limit-');
        const output = await executeMutationScript(strykerHitLimitScript, [
            import.meta.resolve('@stryker-mutator/instrumenter'),
            adapterUrl,
            engineUrl,
            configUrl
        ], cwd);
        scope.assert.equal(output, 'hit limit passed\n');
        return scope.assert.collect();
    }),
    table({
        title: 'freshState preserves mutation identities across sandboxes',
        cases: processModels.flatMap(function executionModes(processModel) {
            return [ false, true ].flatMap(function stateModes(freshState) {
                return { processModel, freshState };
            });
        }),
        caseTitle({ processModel, freshState }) {
            return [ processModel, String(freshState) ].map(String).join(', ');
        },
        async test(scope) {
            const { processModel, freshState } = scope.parameters;

            const outputs: string[] = [];
            for (const prefix of [ 'overkill-stryker-identity-', 'overkill-stryker-replacement-' ]) {
                const cwd = await createMutationProject(scope.cleanup, prefix);
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
    table({
        title: 'freshState executes mutants and reports reload support',
        cases: processModels.flatMap(function executionModes(processModel) {
            return [ false, true ].flatMap(function stateModes(freshState) {
                return { processModel, freshState };
            });
        }),
        caseTitle({ processModel, freshState }) {
            return [ processModel, String(freshState) ].map(String).join(', ');
        },
        async test(scope) {
            const { processModel, freshState } = scope.parameters;

            await scope.assert(verifyMutationLifecycle, processModel, freshState);
            return scope.assert.collect();
        }
    }),
    table({
        title: 'freshState coverage',
        cases: processModels.flatMap(function executionModes(processModel) {
            return [ false, true ].flatMap(function stateModes(freshState) {
                return ([ 'perTest', 'all', 'off' ] as const).map(function coverageModes(coverageAnalysis) {
                    return { processModel, freshState, coverageAnalysis };
                });
            });
        }),
        caseTitle({ processModel, freshState, coverageAnalysis }) {
            return [ processModel, String(freshState), coverageAnalysis ].map(String).join(', ');
        },
        async test(scope) {
            const { processModel, freshState, coverageAnalysis } = scope.parameters;

            const cwd = await createMutationProject(scope.cleanup, 'overkill-stryker-coverage-');
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
            await scope.assert(verifyCampaign, scope.cleanup, {
                processModel,
                freshState,
                looping: false,
                coverageAnalysis
            });
            return scope.assert.collect();
        }
    }),
    table({
        title: 'freshState reaps synchronous loops',
        cases: processModels.flatMap(function executionModes(processModel) {
            return [ false, true ].flatMap(function stateModes(freshState) {
                return { processModel, freshState };
            });
        }),
        caseTitle({ processModel, freshState }) {
            return [ processModel, String(freshState) ].map(String).join(', ');
        },
        async test(scope) {
            const { processModel, freshState } = scope.parameters;

            await scope.assert(verifyCampaign, scope.cleanup, {
                processModel,
                freshState,
                looping: true,
                coverageAnalysis: 'off'
            });
            return scope.assert.collect();
        }
    })
]);
