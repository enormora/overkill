import { createSuite } from '@overkill-dev/engine';
import { createLineReporter } from '@overkill-dev/reporter-line';
import { runIfMain } from '#test-runner';
import { strykerPackageScenarios } from './stryker-package-scenarios.test.ts';
import { createStrykerSmokeCase } from './stryker-package-scenario.test.ts';

export const testNode = createSuite({
    annotations: {},
    children: strykerPackageScenarios.map(createStrykerSmokeCase),
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/integration-tests/package-smoke/stryker-runner.test.ts'
});

await runIfMain(import.meta, testNode, { reporters: [ createLineReporter() ] });
