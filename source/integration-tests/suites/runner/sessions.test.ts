import { suite } from '@overkill-dev/test';

import { testNode as supervisedRunArtifactsTestNode } from '../../../run/supervised-run-artifacts.test.ts';
import { testNode as supervisedRunTestNode } from '../../../run/supervised-run.test.ts';
import { testNode as executionSessionTestNode } from '../../../run/execution-session.test.ts';

export const testNode = suite('runner sessions integration', [
    supervisedRunArtifactsTestNode,
    supervisedRunTestNode,
    executionSessionTestNode
]);
