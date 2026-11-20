import { table, type TestNode, suite, test, type TestScope } from '@overkill-dev/test';

import { strykerCampaignScript, strykerHitLimitScript } from './support/stryker-campaign-scripts.ts';
import { strykerCoverageScript } from './support/stryker-coverage-scripts.ts';
import { strykerIdentityScript } from './support/stryker-identity-scripts.ts';
import {
    createMutationProject,
    engineUrl,
    configUrl,
    adapterUrl,
    verifyMutationLifecycle
} from './support/stryker-lifecycle-fixture.ts';
import { executeMutationScript } from './support/stryker-script.ts';

const metadata = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;
const processModels = [ 'in-process', 'supervised-process' ] as const;
type CampaignMode = {
    readonly processModel: typeof processModels[number];
    readonly freshState: boolean;
    readonly looping: boolean;
    readonly coverageAnalysis: 'all' | 'off' | 'perTest';
};

async function verifyCampaign(scope: TestScope, mode: CampaignMode): Promise<void> {
    const cwd = await createMutationProject(scope, 'overkill-stryker-campaign-');
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

export const testNode: TestNode = suite('Stryker execution lifecycle', [
    test('tracks swallowed hit limits, cleanup coverage, and counter reset', async function (scope) {
        const cwd = await createMutationProject(scope, 'overkill-stryker-hit-limit-');
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
        ...metadata,
        title: 'freshState preserves mutation identities across sandboxes',
        cases: processModels.flatMap(function executionModes(processModel) {
            return [ false, true ].flatMap(function stateModes(freshState) {
                return ({ caseDescription: `${processModel}, ${String(freshState)}`, processModel, freshState });
            });
        }),
        caseTitle: (row) => row.caseDescription,
        async test(scope) {
            const { processModel, freshState } = scope.parameters;

            const outputs: string[] = [];
            for (const prefix of [ 'overkill-stryker-identity-', 'overkill-stryker-replacement-' ]) {
                const cwd = await createMutationProject(scope, prefix);
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
        ...metadata,
        title: 'freshState executes mutants and reports reload support',
        cases: processModels.flatMap(function executionModes(processModel) {
            return [ false, true ].flatMap(function stateModes(freshState) {
                return ({ caseDescription: `${processModel}, ${String(freshState)}`, processModel, freshState });
            });
        }),
        caseTitle: (row) => row.caseDescription,
        async test(scope) {
            const { processModel, freshState } = scope.parameters;

            await verifyMutationLifecycle(scope, processModel, freshState);
            return scope.assert.collect();
        }
    }),
    table({
        ...metadata,
        title: 'freshState coverage',
        cases: processModels.flatMap(function executionModes(processModel) {
            return [ false, true ].flatMap(function stateModes(freshState) {
                return ([ 'perTest', 'all', 'off' ] as const).map(function coverageModes(coverageAnalysis) {
                    return ({
                        caseDescription: `${processModel}, ${String(freshState)}, ${coverageAnalysis}`,
                        processModel,
                        freshState,
                        coverageAnalysis
                    });
                });
            });
        }),
        caseTitle: (row) => row.caseDescription,
        async test(scope) {
            const { processModel, freshState, coverageAnalysis } = scope.parameters;

            const cwd = await createMutationProject(scope, 'overkill-stryker-coverage-');
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
    }),
    table({
        ...metadata,
        title: 'freshState reaps synchronous loops',
        cases: processModels.flatMap(function executionModes(processModel) {
            return [ false, true ].flatMap(function stateModes(freshState) {
                return ({ caseDescription: `${processModel}, ${String(freshState)}`, processModel, freshState });
            });
        }),
        caseTitle: (row) => row.caseDescription,
        async test(scope) {
            const { processModel, freshState } = scope.parameters;

            await verifyCampaign(scope, {
                processModel,
                freshState,
                looping: true,
                coverageAnalysis: 'off'
            });
            return scope.assert.collect();
        }
    })
]);
