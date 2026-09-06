import { createLineReporter as createOverkillLineReporter } from '../packages/reporter-line/reporter-line.entry-point.ts';
import { createSuite as createOverkillSuite, runIfMain } from '../packages/engine/engine.entry-point.ts';
import { testSuite as runDiscoveryTestSuite } from './run-discovery.test.ts';
import { testSuite as runFilterGrammarTestSuite } from './run-filter-grammar.test.ts';
import { testSuite as runProfileDiscriminatorTestSuite } from './run-profile-discriminator.test.ts';
import { testSuite as runSelectionFiltersTestSuite } from './run-selection-filters.test.ts';
import { testSuite as runTestModulesTestSuite } from './run-test-modules.test.ts';

export const testSuite = createOverkillSuite({
    title: 'source/run/run-planning-suite.test.ts',
    metadata: {},
    children: [
        runDiscoveryTestSuite,
        runFilterGrammarTestSuite,
        runProfileDiscriminatorTestSuite,
        runSelectionFiltersTestSuite,
        runTestModulesTestSuite
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
