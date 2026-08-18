import { createSuite } from '@overkill-dev/engine';
import {
    testSuite as githubActionsOutputRendererTestSuite
} from '../../output-renderers/github-actions-output-renderer.test.ts';

export const testSuite = createSuite({
    name: 'source/test-support/unit-suite-groups/output-renderers.ts',
    metadata: {},
    children: [
        githubActionsOutputRendererTestSuite
    ]
});
