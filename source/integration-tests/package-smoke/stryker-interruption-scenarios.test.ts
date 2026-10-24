import { strykerTerminationScript, strykerTerminationCampaignScript } from '../run/stryker-termination-scripts.test.ts';
import { strykerCancellationScript, strykerDisconnectScript } from '../run/stryker-ownership-scripts.test.ts';
import { packagedScenario, type StrykerPackageScenario } from './stryker-package-scenario.test.ts';

const adapter = '@overkill-dev/stryker-runner';
const engine = '@overkill-dev/engine';
const config = '@overkill-dev/run/config';

export const strykerInterruptionScenarios: readonly StrykerPackageScenario[] = [
    packagedScenario('packaged Stryker recovers from native worker abort', strykerTerminationCampaignScript, [
        adapter,
        engine,
        config,
        'in-process',
        'false',
        'abort',
        'body',
        'mutant',
        '@stryker-mutator/core'
    ]),
    ...[ 'in-process', 'supervised-process' ].flatMap(function ownership(processModel) {
        return [
            packagedScenario(`packaged Stryker ${processModel} native exit`, strykerTerminationScript, [
                adapter,
                engine,
                config,
                processModel,
                String(processModel === 'in-process'),
                'exit-zero',
                'body',
                'mutant',
                '@stryker-mutator/instrumenter'
            ]),
            ...[
                { title: 'cancellation', script: strykerCancellationScript },
                { title: 'worker disconnect', script: strykerDisconnectScript }
            ]
                .map(function interruption({ title, script }) {
                    return packagedScenario(`packaged Stryker ${processModel} ${title}`, script, [
                        adapter,
                        engine,
                        config,
                        '@stryker-mutator/instrumenter',
                        processModel,
                        '@overkill-dev/run'
                    ]);
                })
        ];
    }),
    packagedScenario('packaged Stryker supervised freshState native exit', strykerTerminationScript, [
        adapter,
        engine,
        config,
        'supervised-process',
        'true',
        'exit-zero',
        'body',
        'mutant',
        '@stryker-mutator/instrumenter'
    ])
];
