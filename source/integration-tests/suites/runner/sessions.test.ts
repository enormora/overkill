import { createSuite } from '../../../packages/engine/engine.entry-point.ts';
import { testNode as supervisedRunArtifactsTestNode } from '../../../run/supervised-run-artifacts.test.ts';
import { testNode as supervisedRunTestNode } from '../../../run/supervised-run.test.ts';
import { testNode as executionSessionTestNode } from '../../../run/execution-session.test.ts';

export const testNode = createSuite({
    title: 'runner sessions integration',
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    children: [
        supervisedRunArtifactsTestNode,
        supervisedRunTestNode,
        executionSessionTestNode
    ]
});
