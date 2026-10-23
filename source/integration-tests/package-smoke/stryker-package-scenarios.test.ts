import { strykerCampaignScript } from '../run/stryker-campaign-scripts.test.ts';
import { strykerCatalogScript } from '../run/stryker-catalog-scripts.test.ts';
import { strykerCoverageScript } from '../run/stryker-coverage-scripts.test.ts';
import { strykerDryRunScript } from '../run/stryker-dry-run-scripts.test.ts';
import { strykerTimeoutScript } from '../run/stryker-timeout-scripts.test.ts';
import { strykerProfileScript } from './stryker-profile-scripts.test.ts';
import { strykerSandboxScript } from './stryker-sandbox-scripts.test.ts';
import { strykerFreshStateScript } from './stryker-fresh-state-scripts.test.ts';
import { strykerRunnerScript } from './stryker-runner-scripts.test.ts';

export type StrykerPackageScenario = {
    readonly title: string;
    readonly script: string;
};

const adapter = '@overkill-dev/stryker-runner';
const engine = '@overkill-dev/engine';
const config = '@overkill-dev/run/config';
const runnerApi = '@stryker-mutator/api/test-runner';
const coverageModes = [ 'perTest', 'all', 'off' ] as const;

function packagedScenario(title: string, script: string, scriptArguments: readonly string[]): StrykerPackageScenario {
    return {
        title,
        script: `
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const cwd = mkdtempSync(join(tmpdir(), 'overkill-stryker-packaged-'));
const scriptArguments = ${JSON.stringify(scriptArguments)};
const resolvedArguments = scriptArguments.map(value => value.startsWith('@') ? import.meta.resolve(value) : value);
try {
    execFileSync(process.execPath, ['--input-type=module', '--eval', ${JSON.stringify(script)}, ...resolvedArguments],
        {cwd, stdio:'pipe'});
} finally {
    rmSync(cwd, {recursive:true, force:true});
}
console.log('stryker profile initialization passed');
`
    };
}

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
    { title: 'packaged Stryker exposes the plugin and isolates its dependencies', script: strykerRunnerScript },
    packagedScenario('packaged Stryker validates profiles before imports', strykerProfileScript, [ adapter, config ]),
    packagedScenario('packaged Stryker resolves sandbox files', strykerSandboxScript, [ adapter ]),
    packagedScenario('packaged Stryker supports fresh state', strykerFreshStateScript, [
        '@overkill-dev/run',
        engine,
        adapter
    ]),
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
