import { createSuite as createOverkillSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as runDiscoveryTestNode } from './run-discovery.test.ts';
import { testNode as runFilterGrammarTestNode } from './run-filter-grammar.test.ts';
import { testNode as runProfileDiscriminatorTestNode } from './run-profile-discriminator.test.ts';
import { testNode as runSelectionFiltersTestNode } from './run-selection-filters.test.ts';
import { testNode as runTestModulesTestNode } from './run-test-modules.test.ts';

export const testNode = createOverkillSuite({
    definitionLocations: [ { column: null, file: '', line: null } ],
    title: 'source/run/run-planning-suite.test.ts',
    metadata: {},
    children: [
        runDiscoveryTestNode,
        runFilterGrammarTestNode,
        runProfileDiscriminatorTestNode,
        runSelectionFiltersTestNode,
        runTestModulesTestNode
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
