import { runIfMain } from '#test-runner';
import { createSuite as createOverkillSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as collection } from './coverage-collection.test.ts';
import { testNode as recordSuiteTestNode } from './run-record-suite.test.ts';

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/coverage-suite.test.ts',
    annotations: {},
    controls: {},
    children: [ collection, recordSuiteTestNode ]
});

await runIfMain(import.meta, testNode);
