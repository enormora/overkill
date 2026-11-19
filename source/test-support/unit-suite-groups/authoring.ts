import { suite } from '@overkill-dev/test';
import { testNode as eslintTestNode } from '../../eslint-test/eslint-testing-suite.test.ts';
import { testNode as measurementTestNode } from '../../bench/measurement-suite.test.ts';
import { testNode as workloadTestNode } from '../../bench/workload.test.ts';
import { testNode as baselinesTestNode } from '../../baselines/baselines-suite.test.ts';

import { testNode as benchEntryPointTestNode } from '../../packages/bench/bench-entry-point.test.ts';
import { testNode as benchMacroLocationsTestNode } from '../../packages/bench/bench-macro-locations.test.ts';
import { testNode as testPackageTestNode } from '../../packages/test/test-suite.test.ts';
import { testNode as propertyFamilyTestNode } from './property-family.ts';

export const testNode = suite('authoring', [
    eslintTestNode,
    measurementTestNode,
    workloadTestNode,
    baselinesTestNode,
    testPackageTestNode,
    benchEntryPointTestNode,
    benchMacroLocationsTestNode,
    propertyFamilyTestNode
]);
