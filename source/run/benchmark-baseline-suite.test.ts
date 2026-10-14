import { createSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as commands } from '../integration-tests/run/runner-benchmark-baselines.test.ts';
import { testNode as failures } from '../integration-tests/run/runner-benchmark-baseline-failures.test.ts';
import { testNode as commandLine } from '../integration-tests/run/runner-benchmark-baseline-cli.test.ts';
import { testNode as html } from '../integration-tests/run/runner-benchmark-html.test.ts';

export const testNode = createSuite({
    annotations: {},
    children: [ commands, failures, commandLine, html ],
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'benchmark baseline execution'
});
