import { strykerCampaignScript } from '../run/stryker-campaign-scripts.test.ts';
import { strykerCatalogScript } from '../run/stryker-catalog-scripts.test.ts';
import { strykerCoverageScript } from '../run/stryker-coverage-scripts.test.ts';
import { strykerDryRunScript } from '../run/stryker-dry-run-scripts.test.ts';
import { strykerTimeoutScript } from '../run/stryker-timeout-scripts.test.ts';
import { packagedScenario, type StrykerPackageScenario } from './stryker-package-scenario.test.ts';
import { strykerInitializationScenarios } from './stryker-initialization-scenarios.test.ts';
import { strykerInterruptionScenarios } from './stryker-interruption-scenarios.test.ts';

const adapter = '@overkill-dev/stryker-runner';
const engine = '@overkill-dev/engine';
const config = '@overkill-dev/run/config';
const runnerApi = '@stryker-mutator/api/test-runner';
const coverageModes = [ 'perTest', 'all', 'off' ] as const;

function executionScenarios(processModel: string, freshState: string): readonly StrykerPackageScenario[] {
    const title = `packaged Stryker ${processModel} freshState ${freshState}`;
    return [
        ...[ 'mixed', 'cleanup', 'timeout' ].map(function dryRun(scenario) {
            return packagedScenario(`${title} dry run ${scenario}`, strykerDryRunScript, [
                adapter,
                engine,
                config,
                processModel,
                freshState,
                scenario,
                'none',
                runnerApi
            ]);
        }),
        packagedScenario(`${title} catalog`, strykerCatalogScript, [
            adapter,
            engine,
            config,
            processModel,
            freshState,
            'listed-files',
            runnerApi
        ]),
        ...coverageModes.flatMap(function coverage(coverageMode) {
            return [
                packagedScenario(`${title} campaign ${coverageMode}`, strykerCampaignScript, [
                    '@stryker-mutator/core',
                    adapter,
                    engine,
                    config,
                    processModel,
                    freshState,
                    '1',
                    coverageMode
                ]),
                packagedScenario(`${title} coverage ${coverageMode}`, strykerCoverageScript, [
                    '@stryker-mutator/instrumenter',
                    adapter,
                    engine,
                    config,
                    processModel,
                    freshState,
                    coverageMode
                ])
            ];
        })
    ];
}

export const strykerPackageScenarios: readonly StrykerPackageScenario[] = [
    ...strykerInitializationScenarios,
    ...strykerInterruptionScenarios,
    ...[ 'in-process', 'supervised-process' ].flatMap(function processModes(processModel) {
        return [ 'false', 'true' ].flatMap(function stateModes(freshState) {
            return executionScenarios(processModel, freshState);
        });
    }),
    ...([ [ 'in-process', 'body' ], [ 'supervised-process', 'hard' ] ] as const).map(
        function timeout([ processModel, scenario ]) {
            return packagedScenario(`packaged Stryker ${processModel} timeout ${scenario}`, strykerTimeoutScript, [
                adapter,
                engine,
                config,
                '@stryker-mutator/instrumenter',
                processModel,
                scenario
            ]);
        }
    )
];
