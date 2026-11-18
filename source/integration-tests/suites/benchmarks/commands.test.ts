import { createSuite } from '../../../packages/engine/engine.entry-point.ts';
import { testNode as benchmarkHostAdmissionTestNode } from '../../../run/benchmark-host-admission.test.ts';
import { testNode as benchmarkCommandsTestNode } from '../../../run/benchmark-commands.test.ts';

export const testNode = createSuite({
    title: 'benchmarks commands integration',
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    children: [ benchmarkHostAdmissionTestNode, benchmarkCommandsTestNode ]
});
