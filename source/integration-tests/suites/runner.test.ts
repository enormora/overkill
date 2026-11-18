import { createSuite } from '../../packages/engine/engine.entry-point.ts';
import { testNode as cliTestNode } from './runner/cli.test.ts';
import { testNode as runtimeTestNode } from './runner/runtime.test.ts';
import { testNode as outputTestNode } from './runner/output.test.ts';
import { testNode as policyTestNode } from './runner/policy.test.ts';

export const testNode = createSuite({
    title: 'runner integration',
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    children: [ cliTestNode, runtimeTestNode, outputTestNode, policyTestNode ]
});
