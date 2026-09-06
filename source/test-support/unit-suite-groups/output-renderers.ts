import { createSuite } from '../../packages/engine/engine.entry-point.ts';
import {
    testSuite as githubActionsOutputRendererTestSuite
} from '../../output-renderers/github-actions-output-renderer.test.ts';

export const testSuite = createSuite({
    title: 'source/test-support/unit-suite-groups/output-renderers.ts',
    metadata: {},
    children: [
        githubActionsOutputRendererTestSuite
    ]
});
