import { strykerProfileScript } from './stryker-profile-scripts.test.ts';
import { strykerSandboxScript } from './stryker-sandbox-scripts.test.ts';
import { strykerFreshStateScript } from './stryker-fresh-state-scripts.test.ts';
import { strykerRunnerScript } from './stryker-runner-scripts.test.ts';
import { packagedScenario, type StrykerPackageScenario } from './stryker-package-scenario.test.ts';

const adapter = '@overkill-dev/stryker-runner';

export const strykerInitializationScenarios: readonly StrykerPackageScenario[] = [
    { title: 'packaged Stryker exposes the plugin and isolates its dependencies', script: strykerRunnerScript },
    packagedScenario('packaged Stryker validates profiles before imports', strykerProfileScript, [
        adapter,
        '@overkill-dev/run/config'
    ]),
    packagedScenario('packaged Stryker resolves sandbox files', strykerSandboxScript, [ adapter ]),
    packagedScenario('packaged Stryker supports fresh state', strykerFreshStateScript, [
        '@overkill-dev/run',
        '@overkill-dev/engine',
        adapter
    ])
];
