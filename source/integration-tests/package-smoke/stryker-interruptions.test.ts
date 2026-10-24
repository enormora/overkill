import { createSuite } from '@overkill-dev/engine';
import { createLineReporter } from '@overkill-dev/reporter-line';
import { runIfMain } from '#test-runner';
import { strykerInterruptionScenarios } from './stryker-interruption-scenarios.test.ts';
import { createStrykerSmokeCase } from './stryker-package-scenario.test.ts';

export const testNode = createSuite({
    annotations: {},
    children: strykerInterruptionScenarios.map(createStrykerSmokeCase),
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'packaged Stryker native termination and invocation ownership'
});

await runIfMain(import.meta, testNode, { reporters: [ createLineReporter() ] });
