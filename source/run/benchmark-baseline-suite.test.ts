import { createSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as commands } from '../integration-tests/run/runner-benchmark-baselines.test.ts';
import { testNode as failures } from '../integration-tests/run/runner-benchmark-baseline-failures.test.ts';
import { testNode as commandLine } from '../integration-tests/run/runner-benchmark-baseline-cli.test.ts';
import { testNode as normalization } from '../integration-tests/run/runner-benchmark-normalization.test.ts';
import { testNode as benchmarks } from '../integration-tests/run/runner-benchmarks.test.ts';
import { testNode as html } from '../integration-tests/run/runner-benchmark-html.test.ts';
import { testNode as maintenance } from './calibration-maintenance.test.ts';

import { testNode as hostTestNode } from './benchmark-host-suite.test.ts';
import { testNode as placementTestNode } from './benchmark-placement-suite.test.ts';

export const testNode = createSuite({
    annotations: {},
    children: [
        commands,
        failures,
        commandLine,
        normalization,
        maintenance,
        benchmarks,
        html,
        hostTestNode,
        placementTestNode
    ],
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'benchmark baseline execution'
});
