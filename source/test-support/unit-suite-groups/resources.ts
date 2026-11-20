import { suite } from '@overkill-dev/test';

import { testNode as directResourceLifecycleTestNode } from '../../resources/direct-resource-lifecycle.test.ts';
import { testNode as resourceLifecycleDisposalTestNode } from '../../resources/resource-lifecycle-disposal.test.ts';
import { testNode as resourceLifecycleTestNode } from '../../resources/resource-lifecycle.test.ts';
import { testNode as resourceLifecycleRunSuiteTestNode } from '../../run/resource-lifecycle-run-suite.test.ts';
import { testNode as runtimeCompositionTestNode } from '../../resources/runtime-composition.test.ts';
import { testNode as resourcesTestNode } from '../../resources/resources.test.ts';
import { testNode as resourceChecks } from './resource-checks.ts';
import { testNode as simulationTestNode } from './simulation.ts';

import { testNode as localServices } from './local-services.ts';

export const testNode = suite('resources', [
    resourceChecks,
    localServices,
    directResourceLifecycleTestNode,
    resourceLifecycleDisposalTestNode,
    resourceLifecycleTestNode,
    resourceLifecycleRunSuiteTestNode,
    runtimeCompositionTestNode,
    resourcesTestNode,
    simulationTestNode
]);
