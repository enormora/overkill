import { suite } from '@overkill-dev/test';

import { testNode as adapterExecutionTestNode } from '../../../run/adapter-execution.test.ts';
import { testNode as runnerModelContractsTestNode } from '../../run/runner-model-contracts.test.ts';
import { testNode as runnerDifferentialContractsTestNode } from '../../run/runner-differential-contracts.test.ts';
import { testNode as runnerLinearizabilityContractsTestNode } from '../../run/runner-linearizability-contracts.test.ts';
import { testNode as runnerLinearizabilityLifecycleTestNode } from '../../run/runner-linearizability-lifecycle.test.ts';
import { testNode as runnerPropertyValidationTestNode } from '../../run/runner-property-validation.test.ts';
import { testNode as runnerPropertyMeasurementsTestNode } from '../../run/runner-property-measurements.test.ts';
import { testNode as runnerFamilyTransportTestNode } from '../../run/runner-family-transport.test.ts';
import { testNode as runnerFamilySelectionTestNode } from '../../run/runner-family-selection.test.ts';

export const testNode = suite('runner families integration', [
    adapterExecutionTestNode,
    runnerModelContractsTestNode,
    runnerDifferentialContractsTestNode,
    runnerLinearizabilityContractsTestNode,
    runnerLinearizabilityLifecycleTestNode,
    runnerPropertyValidationTestNode,
    runnerPropertyMeasurementsTestNode,
    runnerFamilyTransportTestNode,
    runnerFamilySelectionTestNode
]);
