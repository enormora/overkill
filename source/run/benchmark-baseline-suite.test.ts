import { createSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as commands } from '../integration-tests/run/runner-benchmark-baselines.test.ts';
import { testNode as failures } from '../integration-tests/run/runner-benchmark-baseline-failures.test.ts';
import { testNode as commandLine } from '../integration-tests/run/runner-benchmark-baseline-cli.test.ts';

export const testNode = createSuite({
    annotations: {},
    children: [ commands, failures, commandLine ],
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'benchmark baseline execution'
});
