import { suite } from '@overkill-dev/test';
import { testNode as checkChannel } from '../../../run/resource-check-channel.test.ts';
import { testNode as checkClient } from '../../../run/resource-check-client.test.ts';

import { testNode as resourceReferenceTestNode } from '../../../resources/resource-reference.test.ts';
import { testNode as resourceLifecycleStartupBudgetTestNode } from '../../../run/resource-lifecycle-startup-budget.test.ts';
import { testNode as resourceLifecycleTimingTestNode } from '../../../run/resource-lifecycle-timing.test.ts';

import { testNode as resourceChecksTestNode } from '../../../resources/resource-checks.test.ts';
import { testNode as resourceCheckIsolationTestNode } from '../../../resources/resource-check-isolation.test.ts';
import { testNode as resourceCheckFailuresTestNode } from '../../../resources/resource-check-failures.test.ts';

export const testNode = suite('resources lifecycle integration', [
    checkChannel,

    checkClient,
    resourceChecksTestNode,
    resourceCheckIsolationTestNode,
    resourceCheckFailuresTestNode,
    resourceReferenceTestNode,
    resourceLifecycleStartupBudgetTestNode,
    resourceLifecycleTimingTestNode
]);
