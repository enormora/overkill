import { suite } from '@overkill-dev/test';

import { testNode as githubActionsTestNode } from '../../output-renderers/github-actions-output-renderer.test.ts';
import { testNode as workerPoolRuntimeFixturesTestNode } from '../worker-pool-runtime-fixtures.test.ts';

export const testNode = suite('source/test-support/unit-suite-groups/output-renderers.ts', [
    githubActionsTestNode,
    workerPoolRuntimeFixturesTestNode
]);
