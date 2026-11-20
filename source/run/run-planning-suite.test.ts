import { suite } from '@overkill-dev/test';

import { testNode as runPlanConstructionTestNode } from './run-plan-construction-suite.test.ts';
import { testNode as runDiscoveryTestNode } from './run-discovery.test.ts';
import { testNode as runFilterGrammarTestNode } from './run-filter-grammar.test.ts';
import { testNode as runProfileFileSetsTestNode } from './run-profile-file-sets.test.ts';
import { testNode as runProfileDiscriminatorTestNode } from './run-profile-discriminator.test.ts';
import { testNode as runSelectionTestNode } from './run-selection-suite.test.ts';
import { testNode as runSupportTestNode } from './run-support.test.ts';
import { testNode as runTestModulesTestNode } from './run-test-modules.test.ts';

export const testNode = suite('source/run/run-planning-suite.test.ts', [
    runPlanConstructionTestNode,
    runDiscoveryTestNode,
    runFilterGrammarTestNode,
    runProfileFileSetsTestNode,
    runProfileDiscriminatorTestNode,
    runSelectionTestNode,
    runSupportTestNode,
    runTestModulesTestNode
]);
