import { suite } from '@overkill-dev/test';

import { testNode as nodeProcessExitTestNode } from '../../../../run/node-process-exit.test.ts';
import { testNode as supervisedChildTestNode } from '../../../../run/supervised-child.test.ts';
import { testNode as nodeChildProcessStartersTestNode } from '../../../../run/node-child-process-starters.test.ts';
import { testNode as workerPoolHostProtocolTestNode } from '../../../../run/worker-pool-host-protocol.test.ts';
import { testNode as runnerStrykerWorkerReuseTestNode } from '../../../run/runner-stryker-worker-reuse.test.ts';

export const testNode = suite('runner workers hosts integration', [
    nodeProcessExitTestNode,
    supervisedChildTestNode,
    nodeChildProcessStartersTestNode,
    workerPoolHostProtocolTestNode,
    runnerStrykerWorkerReuseTestNode
]);
