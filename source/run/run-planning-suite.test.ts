import { createSuite as createOverkillSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as runDiscoveryTestNode } from './run-discovery.test.ts';
import { testNode as runFilterGrammarTestNode } from './run-filter-grammar.test.ts';
import { testNode as runProfileFileSetsTestNode } from './run-profile-file-sets.test.ts';
import { testNode as runProfileDiscriminatorTestNode } from './run-profile-discriminator.test.ts';
import { testNode as runSelectionFiltersTestNode } from './run-selection-filters.test.ts';
import { testNode as runTestModulesTestNode } from './run-test-modules.test.ts';

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/run-planning-suite.test.ts',
    metadata: {},
    children: [
        runDiscoveryTestNode,
        runFilterGrammarTestNode,
        runProfileFileSetsTestNode,
        runProfileDiscriminatorTestNode,
        runSelectionFiltersTestNode,
        runTestModulesTestNode
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
