import { createSuite } from '../../packages/engine/engine.entry-point.ts';
import {
    testNode as githubActionsOutputRendererTestNode
} from '../../output-renderers/github-actions-output-renderer.test.ts';

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/test-support/unit-suite-groups/output-renderers.ts',
    metadata: {},
    children: [
        githubActionsOutputRendererTestNode
    ]
});
