import { createLineReporter as createOverkillLineReporter } from '@overkill-dev/reporter-line';
import { createSuite as createOverkillSuite, runIfMain } from '@overkill-dev/engine';
import { testSuite as runDiscoveryTestSuite } from './run-discovery.test.ts';
import { testSuite as runProfileDiscriminatorTestSuite } from './run-profile-discriminator.test.ts';
import { testSuite as runSelectionFiltersTestSuite } from './run-selection-filters.test.ts';
import { testSuite as runTestModulesTestSuite } from './run-test-modules.test.ts';

export const testSuite = createOverkillSuite({
    name: 'source/run/run-planning-suite.test.ts',
    metadata: {},
    children: [
        runDiscoveryTestSuite,
        runProfileDiscriminatorTestSuite,
        runSelectionFiltersTestSuite,
        runTestModulesTestSuite
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
