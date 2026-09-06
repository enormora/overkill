import { createLineReporter as createOverkillLineReporter } from '../packages/reporter-line/reporter-line.entry-point.ts';
import { createSuite as createOverkillSuite, runIfMain } from '../packages/engine/engine.entry-point.ts';
import { testSuite as runSelectionTestSuite } from './run-selection.test.ts';
import { testSuite as runTestSuite } from './run.test.ts';

export const testSuite = createOverkillSuite({
    title: 'source/run/run-orchestrator-core-suite.test.ts',
    metadata: {},
    children: [
        runSelectionTestSuite,
        runTestSuite
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
