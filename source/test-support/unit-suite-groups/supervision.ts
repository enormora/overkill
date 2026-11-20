import { suite } from '@overkill-dev/test';
import { testNode as permissionDenials } from '../../run/permission-denial-runtime-policy.test.ts';
import { testNode as lifecycle } from '../../run/execution-lifecycle-policy.test.ts';

import { testNode as debugArtifactStorage } from '../../run/debug-artifact-storage.test.ts';
import { testNode as workerPoolHostProcess } from '../../run/worker-pool-host-process.test.ts';
import { testNode as workerPoolHostTransport } from '../../run/worker-pool-host-transport.test.ts';
import { testNode as supervisedRunProtocolOrder } from '../../run/supervised-run-protocol-order.test.ts';
import { testNode as supervisedCancellation } from '../../run/supervised-cancellation.test.ts';

import { testNode as outputCapture } from '../../run/worker-output-capture.test.ts';

import { testNode as executionSessions } from '../../run/execution-session-ownership.test.ts';

export const testNode = suite('process supervision contracts', [
    executionSessions,
    permissionDenials,
    lifecycle,
    outputCapture,
    debugArtifactStorage,
    workerPoolHostProcess,
    workerPoolHostTransport,
    supervisedRunProtocolOrder,
    supervisedCancellation
]);
