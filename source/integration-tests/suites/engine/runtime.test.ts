import { suite } from '@overkill-dev/test';
import { testNode as assertionControlTestNode } from '../../../engine/test-control-error.test.ts';

import { testNode as failureArtifactContextTestNode } from '../../../engine/failure-artifact-context.test.ts';
import { testNode as executionGlobalErrorObserverTestNode } from '../../../engine/execution-global-error-observer.test.ts';
import { testNode as nativeGuardOwnershipTestNode } from '../../../engine/native-guard-ownership.test.ts';
import { testNode as nativeErrorOwnershipTestNode } from '../../../engine/native-error-ownership.test.ts';
import { testNode as testDebugLifecycleTestNode } from '../../../engine/test-debug-lifecycle.test.ts';
import { testNode as resourceOwnerObservationTestNode } from '../../../engine/resource-owner-observation.test.ts';

export const testNode = suite('engine runtime integration', [
    assertionControlTestNode,
    failureArtifactContextTestNode,
    executionGlobalErrorObserverTestNode,
    nativeGuardOwnershipTestNode,
    nativeErrorOwnershipTestNode,
    testDebugLifecycleTestNode,
    resourceOwnerObservationTestNode
]);
