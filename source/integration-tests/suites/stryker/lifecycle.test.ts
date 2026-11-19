import { suite } from '@overkill-dev/test';

import { testNode as mutationDiagnosticPersistenceTestNode } from '../../../packages/stryker-runner/mutation-diagnostic-persistence.test.ts';
import { testNode as runnerStrykerLifecycleTestNode } from '../../run/runner-stryker-lifecycle.test.ts';
import { testNode as mutationSandboxTestNode } from '../../../packages/stryker-runner/mutation-sandbox.test.ts';
import { testNode as runnerStrykerTimeoutsTestNode } from '../../run/runner-stryker-timeouts.test.ts';
import { testNode as runnerStrykerTerminationTestNode } from '../../run/runner-stryker-termination.test.ts';
import { testNode as runnerStrykerOwnershipTestNode } from '../../run/runner-stryker-ownership.test.ts';
import { testNode as runnerStrykerPersistenceTestNode } from '../../run/runner-stryker-persistence.test.ts';

export const testNode = suite('stryker lifecycle integration', [
    mutationDiagnosticPersistenceTestNode,
    runnerStrykerLifecycleTestNode,
    mutationSandboxTestNode,
    runnerStrykerTimeoutsTestNode,
    runnerStrykerTerminationTestNode,
    runnerStrykerOwnershipTestNode,
    runnerStrykerPersistenceTestNode
]);
