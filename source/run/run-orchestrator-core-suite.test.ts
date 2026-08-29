import { createLineReporter as createOverkillLineReporter } from '@overkill-dev/reporter-line';
import { createSuite as createOverkillSuite, runIfMain } from '@overkill-dev/engine';
import { testSuite as runSelectionTestSuite } from './run-selection.test.ts';
import { testSuite as runTestSuite } from './run.test.ts';

export const testSuite = createOverkillSuite({
    name: 'source/run/run-orchestrator-core-suite.test.ts',
    metadata: {},
    children: [
        runSelectionTestSuite,
        runTestSuite
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
